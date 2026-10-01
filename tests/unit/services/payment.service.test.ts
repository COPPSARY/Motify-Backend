import { describe, expect, it, vi } from 'vitest';

import type { TransactionLookup } from '../../../packages/bakong/client.js';
import { parseBillingPlans, parseCreditPacks } from '../../../src/config/env.js';
import { AppError } from '../../../src/errors.js';
import {
  createBillNumber,
  nextSubscriptionPeriod,
  PaymentService,
  type NewPayment,
  type PaymentRecord,
  type PaymentRepository,
  type Purchase,
  type SubscriptionRecord,
} from '../../../src/services/payment.service.js';
import type { WorkspaceRole } from '../../../src/services/workspace.service.js';

const owner = '00000000-0000-4000-8000-000000000001';
const editor = '00000000-0000-4000-8000-000000000009';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const DAY = 24 * 60 * 60 * 1000;

class MemoryPaymentRepository implements PaymentRepository {
  payments = new Map<string, PaymentRecord & { failureReason?: string | null; bakongHash?: string }>();
  subscriptions = new Map<string, SubscriptionRecord>();
  roles = new Map<string, WorkspaceRole>([[owner, 'owner'], [editor, 'editor']]);
  /** Ledger grants keyed by payment id, mirroring the unique (reference_id, kind) index. */
  grants = new Map<string, { userId: string; units: number }>();
  private sequence = 0;

  async getMembership(_workspaceId: string, userId: string) {
    const role = this.roles.get(userId);
    return role ? { role } : null;
  }
  async findReusablePending(workspace: string, createdBy: string, purchase: Purchase, validUntil: Date) {
    return [...this.payments.values()].find((payment) => payment.workspaceId === workspace
      && ('plan' in purchase ? payment.plan === purchase.plan : payment.creditPack === purchase.creditPack && payment.createdBy === createdBy)
      && payment.status === 'PENDING' && payment.expiresAt > validUntil) ?? null;
  }
  async create(payment: NewPayment) {
    this.sequence += 1;
    const record: PaymentRecord = {
      ...payment, id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
      status: 'PENDING', lastCheckedAt: null, paidAt: null, createdAt: new Date(),
    };
    this.payments.set(record.id, record);
    return record;
  }
  async get(paymentId: string) { return this.payments.get(paymentId) ?? null; }
  async listPending(limit: number) { return [...this.payments.values()].filter((payment) => payment.status === 'PENDING').slice(0, limit); }
  async markChecked(paymentId: string, checkedAt: Date) {
    const payment = this.payments.get(paymentId);
    if (payment) payment.lastCheckedAt = checkedAt;
  }
  async close(paymentId: string, status: 'EXPIRED' | 'FAILED', reason: string | null) {
    const payment = this.payments.get(paymentId);
    if (payment?.status !== 'PENDING') return null;
    Object.assign(payment, { status, failureReason: reason });
    return payment;
  }
  async activate(
    paymentId: string,
    transaction: { hash: string; payerAccountId: string; paidAt: Date },
    nextPeriod: ((current: SubscriptionRecord | null) => { start: Date; end: Date }) | null,
  ) {
    const payment = this.payments.get(paymentId)!;
    if (payment.status !== 'PENDING') return payment;
    Object.assign(payment, { status: 'PAID', paidAt: transaction.paidAt, bakongHash: transaction.hash });
    if (payment.plan && nextPeriod) {
      const period = nextPeriod(this.subscriptions.get(payment.workspaceId) ?? null);
      this.subscriptions.set(payment.workspaceId, { workspaceId: payment.workspaceId, plan: payment.plan, currentPeriodStart: period.start, currentPeriodEnd: period.end });
    }
    this.grant(payment);
    return payment;
  }
  async grantMissingCredits(limit: number) {
    const missing = [...this.payments.values()].filter((payment) => payment.status === 'PAID' && payment.creditUnits > 0 && !this.grants.has(payment.id));
    missing.slice(0, limit).forEach((payment) => this.grant(payment));
    return Math.min(missing.length, limit);
  }
  async getCreditBalance(userId: string) {
    return [...this.grants.values()].filter((grant) => grant.userId === userId).reduce((sum, grant) => sum + grant.units, 0);
  }
  async getSubscription(workspace: string) { return this.subscriptions.get(workspace) ?? null; }
  private grant(payment: PaymentRecord) {
    if (payment.creditUnits > 0 && !this.grants.has(payment.id)) this.grants.set(payment.id, { userId: payment.createdBy, units: payment.creditUnits });
  }
}

function setup(lookup: TransactionLookup | Error = { status: 'NOT_FOUND' }, plans = parseBillingPlans({}), creditPacks = parseCreditPacks(undefined)) {
  let now = new Date('2026-09-29T08:00:00.000Z');
  const repository = new MemoryPaymentRepository();
  const gateway = {
    checkTransactionByMd5: vi.fn(async () => {
      if (lookup instanceof Error) throw lookup;
      return lookup;
    }),
  };
  const generateKhqr = vi.fn((payment: { billNumber: string }) => ({ qr: `qr-${payment.billNumber}`, md5: `md5-${payment.billNumber}` }));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new PaymentService(repository, gateway, {
    plans, creditPacks, receiverAccountId: 'motify@aclb', generateKhqr, qrTtlMs: 10 * 60_000, now: () => now, logger,
  });
  return {
    repository, gateway, generateKhqr, logger, service,
    setLookup: (next: TransactionLookup | Error) => { lookup = next; },
    advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    now: () => now,
  };
}

const paid = (amount = 20, overrides: Partial<{ toAccountId: string; currency: string }> = {}): TransactionLookup => ({
  status: 'PAID',
  transaction: { hash: 'hash-1', fromAccountId: 'payer@abaa', toAccountId: 'motify@aclb', currency: 'USD', amount, ...overrides },
});

describe('PaymentService.createCheckout', () => {
  it('creates a dynamic KHQR priced from the plan', async () => {
    const { service, generateKhqr, now } = setup();

    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });

    expect(generateKhqr).toHaveBeenCalledWith(expect.objectContaining({
      amount: 20, currency: 'USD', expiresAt: new Date(now().getTime() + 10 * 60_000), storeLabel: 'Motify Pro',
    }));
    expect(checkout).toMatchObject({ plan: 'pro', amount: 20, currency: 'USD', status: 'PENDING', qr: expect.stringMatching(/^qr-MTF-/) });
    expect(checkout).not.toHaveProperty('md5');
  });

  it('charges the configured price and period, not a built-in one', async () => {
    const plans = parseBillingPlans({ PLAN_PRO_PRICE: '14.99', PLAN_PRO_NAME: 'Creator', BILLING_PERIOD_DAYS: '31' });
    const { service, generateKhqr, setLookup, repository } = setup(undefined, plans);

    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    expect(generateKhqr).toHaveBeenCalledWith(expect.objectContaining({ amount: 14.99, storeLabel: 'Motify Creator' }));
    expect(checkout.amount).toBe(14.99);
    expect(service.listPlans()).toContainEqual(expect.objectContaining({ id: 'pro', name: 'Creator', price: 14.99, periodDays: 31 }));

    setLookup(paid(20));
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED' });
    expect(repository.subscriptions.size).toBe(0);

    const second = setup(paid(14.99), plans);
    const retry = await second.service.createCheckout(owner, workspaceId, { plan: 'pro' });
    await expect(second.service.getPayment(owner, retry.id)).resolves.toMatchObject({ status: 'PAID' });
    expect(second.repository.subscriptions.get(workspaceId)?.currentPeriodEnd).toEqual(new Date(second.now().getTime() + 31 * DAY));
  });

  it('keeps charging an open checkout the price it was created at after a price change', async () => {
    const { service, repository } = setup(paid(10));
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'starter' });

    const repriced = new PaymentService(repository, { checkTransactionByMd5: async () => paid(10) }, {
      plans: parseBillingPlans({ PLAN_STARTER_PRICE: '12' }), creditPacks: [], receiverAccountId: 'motify@aclb',
      generateKhqr: () => ({ qr: 'qr', md5: 'md5' }), qrTtlMs: 180_000,
    });
    await expect(repriced.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PAID', amount: 10 });
  });

  it('refuses a plan switched off in settings', async () => {
    const { service } = setup(undefined, parseBillingPlans({ PLAN_PRO_AVAILABLE: 'false', PLAN_STUDIO_AVAILABLE: 'true' }));
    await expect(service.createCheckout(owner, workspaceId, { plan: 'pro' })).rejects.toMatchObject({ code: 'PLAN_UNAVAILABLE' });
    await expect(service.createCheckout(owner, workspaceId, { plan: 'studio' })).resolves.toMatchObject({ plan: 'studio', amount: 50 });
  });

  it('reuses an open checkout for the same plan instead of minting a new QR', async () => {
    const { service, generateKhqr } = setup();
    const first = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    const second = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    expect(second.id).toBe(first.id);
    expect(generateKhqr).toHaveBeenCalledTimes(1);
  });

  it('only lets owners buy, and refuses plans that are not on sale', async () => {
    const { service } = setup();
    await expect(service.createCheckout(editor, workspaceId, { plan: 'pro' })).rejects.toMatchObject({ status: 403 });
    await expect(service.createCheckout('00000000-0000-4000-8000-00000000dead', workspaceId, { plan: 'pro' })).rejects.toMatchObject({ status: 404 });
    await expect(service.createCheckout(owner, workspaceId, { plan: 'studio' })).rejects.toMatchObject({ code: 'PLAN_UNAVAILABLE' });
  });
});

describe('PaymentService.getPayment', () => {
  it('activates the plan once Bakong reports a matching payment', async () => {
    const { service, repository, setLookup, now } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    setLookup(paid(20));

    const result = await service.getPayment(owner, checkout.id);

    expect(result).toMatchObject({ status: 'PAID', qr: null, subscription: { status: 'active', plan: 'pro' } });
    expect(repository.subscriptions.get(workspaceId)?.currentPeriodEnd).toEqual(new Date(now().getTime() + 30 * DAY));
  });

  it('lets any member read the payment but hides it from outsiders', async () => {
    const { service } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'starter' });
    await expect(service.getPayment(editor, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(service.getPayment('00000000-0000-4000-8000-00000000dead', checkout.id)).rejects.toBeInstanceOf(AppError);
  });

  it('throttles Bakong lookups between polls', async () => {
    const { service, gateway, advance } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    await service.getPayment(owner, checkout.id);
    await service.getPayment(owner, checkout.id);
    expect(gateway.checkTransactionByMd5).toHaveBeenCalledTimes(1);
    advance(5_000);
    await service.getPayment(owner, checkout.id);
    expect(gateway.checkTransactionByMd5).toHaveBeenCalledTimes(2);
  });

  it('refuses to activate a transaction whose amount, currency or receiver differ', async () => {
    for (const lookup of [paid(10), paid(20, { currency: 'KHR' }), paid(20, { toAccountId: 'someone@aclb' })]) {
      const { service, setLookup, repository, logger } = setup();
      const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
      setLookup(lookup);
      await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED' });
      expect(repository.subscriptions.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    }
  });

  it('expires an unpaid checkout only after the grace period', async () => {
    const { service, advance } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    advance(11 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    advance(2 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'EXPIRED', qr: null });
  });

  it('keeps a payment pending when Bakong cannot be reached, even past expiry', async () => {
    const { service, advance, logger } = setup(new Error('HTTP 403'));
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    advance(60 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('marks the payment failed when Bakong reports the transaction failed', async () => {
    const { service } = setup({ status: 'FAILED' });
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'pro' });
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED' });
  });
});

describe('PaymentService credits', () => {
  it('adds the plan credits to the buyer when a plan is paid', async () => {
    const { service, setLookup, repository } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'starter' });
    expect(checkout).toMatchObject({ kind: 'PLAN', plan: 'starter', creditPack: null, credits: 150 });
    setLookup(paid(10));

    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({
      status: 'PAID', subscription: { status: 'active', plan: 'starter' }, creditBalance: 150,
    });
    expect(repository.grants.get(checkout.id)).toEqual({ userId: owner, units: 15_000 });
  });

  it('grants the credits a plan had at checkout, even if the setting changes before payment', async () => {
    const plans = parseBillingPlans({ PLAN_STARTER_CREDITS: '200' });
    const { service, setLookup, repository } = setup(undefined, plans);
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'starter' });
    const later = new PaymentService(repository, { checkTransactionByMd5: async () => paid(10) }, {
      plans: parseBillingPlans({}), creditPacks: [], receiverAccountId: 'motify@aclb',
      generateKhqr: () => ({ qr: 'qr', md5: 'md5' }), qrTtlMs: 180_000,
    });
    setLookup(paid(10));
    await expect(later.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PAID', creditBalance: 200 });
  });

  it('sells credit packs to any member and credits only the buyer', async () => {
    const { service, generateKhqr, setLookup, repository } = setup();
    expect(service.listCreditPacks()).toEqual([
      { id: 'credits-30', price: 2.5, currency: 'USD', credits: 30 },
      { id: 'credits-65', price: 5, currency: 'USD', credits: 65 },
      { id: 'credits-135', price: 10, currency: 'USD', credits: 135 },
      { id: 'credits-350', price: 25, currency: 'USD', credits: 350 },
      { id: 'credits-720', price: 50, currency: 'USD', credits: 720 },
      { id: 'credits-1450', price: 100, currency: 'USD', credits: 1450 },
    ]);

    const checkout = await service.createCheckout(editor, workspaceId, { creditPack: 'credits-135' });
    expect(checkout).toMatchObject({ kind: 'CREDIT_PACK', plan: null, creditPack: 'credits-135', credits: 135, amount: 10 });
    expect(generateKhqr).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, storeLabel: 'Motify 135 credits' }));

    setLookup(paid(10));
    await expect(service.getPayment(editor, checkout.id)).resolves.toMatchObject({ status: 'PAID', subscription: null, creditBalance: 135 });
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PAID', creditBalance: null });
    expect(repository.subscriptions.size).toBe(0);
    expect(repository.grants.get(checkout.id)).toEqual({ userId: editor, units: 13_500 });
  });

  it('charges the pack price with cents and rejects a short payment', async () => {
    const { service, generateKhqr, setLookup } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { creditPack: 'credits-30' });
    expect(generateKhqr).toHaveBeenCalledWith(expect.objectContaining({ amount: 2.5 }));
    setLookup(paid(2));
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED', creditBalance: null });
  });

  it('reuses an open pack checkout only for the same buyer', async () => {
    const { service, generateKhqr } = setup();
    const mine = await service.createCheckout(owner, workspaceId, { creditPack: 'credits-65' });
    await expect(service.createCheckout(owner, workspaceId, { creditPack: 'credits-65' })).resolves.toMatchObject({ id: mine.id });
    await expect(service.createCheckout(editor, workspaceId, { creditPack: 'credits-65' })).resolves.not.toMatchObject({ id: mine.id });
    expect(generateKhqr).toHaveBeenCalledTimes(2);
  });

  it('refuses a pack that is not on sale', async () => {
    const { service } = setup(undefined, parseBillingPlans({}), parseCreditPacks('5:65'));
    await expect(service.createCheckout(owner, workspaceId, { creditPack: 'credits-30' })).rejects.toMatchObject({ status: 409, code: 'CREDIT_PACK_UNAVAILABLE' });
  });

  it('fills in credits for payments that were paid before credits were granted', async () => {
    const { service, setLookup, repository } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, { plan: 'starter' });
    setLookup(paid(10));
    await service.getPayment(owner, checkout.id);
    repository.grants.clear();

    await expect(service.reconcilePending()).resolves.toMatchObject({ credited: 1 });
    await expect(service.reconcilePending()).resolves.toMatchObject({ credited: 0 });
    expect(repository.grants.get(checkout.id)?.units).toBe(15_000);
  });
});

describe('PaymentService.reconcilePending', () => {
  it('activates payments nobody is polling', async () => {
    const { service, setLookup, repository } = setup();
    await service.createCheckout(owner, workspaceId, { plan: 'starter' });
    setLookup(paid(10));
    await expect(service.reconcilePending()).resolves.toEqual({ checked: 1, paid: 1, credited: 0 });
    expect(repository.subscriptions.get(workspaceId)?.plan).toBe('starter');
  });
});

describe('nextSubscriptionPeriod', () => {
  const paidAt = new Date('2026-09-29T00:00:00.000Z');

  it('starts a 30-day period for a new subscriber', () => {
    expect(nextSubscriptionPeriod(null, 'pro', paidAt, 30)).toEqual({ start: paidAt, end: new Date(paidAt.getTime() + 30 * DAY) });
  });

  it('extends an active period of the same plan', () => {
    const current = { workspaceId, plan: 'pro' as const, currentPeriodStart: new Date(paidAt.getTime() - 20 * DAY), currentPeriodEnd: new Date(paidAt.getTime() + 10 * DAY) };
    expect(nextSubscriptionPeriod(current, 'pro', paidAt, 30)).toEqual({ start: current.currentPeriodStart, end: new Date(paidAt.getTime() + 40 * DAY) });
  });

  it('starts over on a plan change or after the period lapsed', () => {
    const active = { workspaceId, plan: 'starter' as const, currentPeriodStart: new Date(paidAt.getTime() - 20 * DAY), currentPeriodEnd: new Date(paidAt.getTime() + 10 * DAY) };
    expect(nextSubscriptionPeriod(active, 'pro', paidAt, 30).start).toEqual(paidAt);
    const lapsed = { ...active, plan: 'pro' as const, currentPeriodEnd: new Date(paidAt.getTime() - DAY) };
    expect(nextSubscriptionPeriod(lapsed, 'pro', paidAt, 30).start).toEqual(paidAt);
  });
});

describe('createBillNumber', () => {
  it('fits the 25-character KHQR bill number limit', () => {
    const billNumber = createBillNumber();
    expect(billNumber).toMatch(/^MTF-[A-Z2-9]{10}$/);
    expect(billNumber.length).toBeLessThanOrEqual(25);
  });
});
