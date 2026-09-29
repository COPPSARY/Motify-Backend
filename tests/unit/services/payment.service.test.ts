import { describe, expect, it, vi } from 'vitest';

import type { TransactionLookup } from '../../../packages/bakong/client.js';
import { AppError } from '../../../src/errors.js';
import {
  createBillNumber,
  nextSubscriptionPeriod,
  PaymentService,
  type NewPayment,
  type PaymentRecord,
  type PaymentRepository,
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
  private sequence = 0;

  async getMembership(_workspaceId: string, userId: string) {
    const role = this.roles.get(userId);
    return role ? { role } : null;
  }
  async findReusablePending(workspace: string, plan: string, validUntil: Date) {
    return [...this.payments.values()].find((payment) => payment.workspaceId === workspace && payment.plan === plan
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
  async activate(paymentId: string, transaction: { hash: string; payerAccountId: string; paidAt: Date }, nextPeriod: (current: SubscriptionRecord | null) => { start: Date; end: Date }) {
    const payment = this.payments.get(paymentId)!;
    if (payment.status !== 'PENDING') return payment;
    Object.assign(payment, { status: 'PAID', paidAt: transaction.paidAt, bakongHash: transaction.hash });
    const period = nextPeriod(this.subscriptions.get(payment.workspaceId) ?? null);
    this.subscriptions.set(payment.workspaceId, { workspaceId: payment.workspaceId, plan: payment.plan, currentPeriodStart: period.start, currentPeriodEnd: period.end });
    return payment;
  }
  async getSubscription(workspace: string) { return this.subscriptions.get(workspace) ?? null; }
}

function setup(lookup: TransactionLookup | Error = { status: 'NOT_FOUND' }) {
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
    receiverAccountId: 'motify@aclb', generateKhqr, qrTtlMs: 10 * 60_000, now: () => now, logger,
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

    const checkout = await service.createCheckout(owner, workspaceId, 'pro');

    expect(generateKhqr).toHaveBeenCalledWith(expect.objectContaining({
      amount: 20, currency: 'USD', expiresAt: new Date(now().getTime() + 10 * 60_000), storeLabel: 'Motify Pro',
    }));
    expect(checkout).toMatchObject({ plan: 'pro', amount: 20, currency: 'USD', status: 'PENDING', qr: expect.stringMatching(/^qr-MTF-/) });
    expect(checkout).not.toHaveProperty('md5');
  });

  it('reuses an open checkout for the same plan instead of minting a new QR', async () => {
    const { service, generateKhqr } = setup();
    const first = await service.createCheckout(owner, workspaceId, 'pro');
    const second = await service.createCheckout(owner, workspaceId, 'pro');
    expect(second.id).toBe(first.id);
    expect(generateKhqr).toHaveBeenCalledTimes(1);
  });

  it('only lets owners buy, and refuses plans that are not on sale', async () => {
    const { service } = setup();
    await expect(service.createCheckout(editor, workspaceId, 'pro')).rejects.toMatchObject({ status: 403 });
    await expect(service.createCheckout('00000000-0000-4000-8000-00000000dead', workspaceId, 'pro')).rejects.toMatchObject({ status: 404 });
    await expect(service.createCheckout(owner, workspaceId, 'studio')).rejects.toMatchObject({ code: 'PLAN_UNAVAILABLE' });
  });
});

describe('PaymentService.getPayment', () => {
  it('activates the plan once Bakong reports a matching payment', async () => {
    const { service, repository, setLookup, now } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, 'pro');
    setLookup(paid(20));

    const result = await service.getPayment(owner, checkout.id);

    expect(result).toMatchObject({ status: 'PAID', qr: null, subscription: { status: 'active', plan: 'pro' } });
    expect(repository.subscriptions.get(workspaceId)?.currentPeriodEnd).toEqual(new Date(now().getTime() + 30 * DAY));
  });

  it('lets any member read the payment but hides it from outsiders', async () => {
    const { service } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, 'starter');
    await expect(service.getPayment(editor, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(service.getPayment('00000000-0000-4000-8000-00000000dead', checkout.id)).rejects.toBeInstanceOf(AppError);
  });

  it('throttles Bakong lookups between polls', async () => {
    const { service, gateway, advance } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, 'pro');
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
      const checkout = await service.createCheckout(owner, workspaceId, 'pro');
      setLookup(lookup);
      await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED' });
      expect(repository.subscriptions.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    }
  });

  it('expires an unpaid checkout only after the grace period', async () => {
    const { service, advance } = setup();
    const checkout = await service.createCheckout(owner, workspaceId, 'pro');
    advance(11 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    advance(2 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'EXPIRED', qr: null });
  });

  it('keeps a payment pending when Bakong cannot be reached, even past expiry', async () => {
    const { service, advance, logger } = setup(new Error('HTTP 403'));
    const checkout = await service.createCheckout(owner, workspaceId, 'pro');
    advance(60 * 60_000);
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'PENDING' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('marks the payment failed when Bakong reports the transaction failed', async () => {
    const { service } = setup({ status: 'FAILED' });
    const checkout = await service.createCheckout(owner, workspaceId, 'pro');
    await expect(service.getPayment(owner, checkout.id)).resolves.toMatchObject({ status: 'FAILED' });
  });
});

describe('PaymentService.reconcilePending', () => {
  it('activates payments nobody is polling', async () => {
    const { service, setLookup, repository } = setup();
    await service.createCheckout(owner, workspaceId, 'starter');
    setLookup(paid(10));
    await expect(service.reconcilePending()).resolves.toEqual({ checked: 1, paid: 1 });
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
