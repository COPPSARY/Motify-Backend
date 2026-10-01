import { randomBytes } from 'node:crypto';

import type { Logger } from 'pino';

import type { TransactionLookup } from '../../packages/bakong/client.js';
import type { Khqr, KhqrPaymentRequest } from '../../packages/bakong/khqr.js';
import type { SandboxOutcome } from '../../packages/bakong/sandbox.js';
import { AppError } from '../errors.js';
import type { BillingPlan, CreditPack, PlanId } from './billing-plans.js';
import { CREDIT_SCALE } from './credit.service.js';
import type { WorkspaceRole } from './workspace.service.js';

export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
export type PaymentCurrency = 'USD' | 'KHR';
export type PaymentKind = 'PLAN' | 'CREDIT_PACK';

/** What a checkout buys: a plan for the workspace, or a pack of credits for the buyer. */
export type Purchase = { plan: PlanId } | { creditPack: string };

export interface PaymentRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  kind: PaymentKind;
  plan: PlanId | null;
  creditPack: string | null;
  /** Credits granted to `createdBy` once PAID, in hundredths. */
  creditUnits: number;
  amountMinor: number;
  currency: PaymentCurrency;
  billNumber: string;
  qr: string;
  md5: string;
  status: PaymentStatus;
  expiresAt: Date;
  lastCheckedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface SubscriptionRecord {
  workspaceId: string;
  plan: PlanId;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface NewPayment {
  workspaceId: string;
  createdBy: string;
  kind: PaymentKind;
  plan: PlanId | null;
  creditPack: string | null;
  creditUnits: number;
  amountMinor: number;
  currency: PaymentCurrency;
  billNumber: string;
  qr: string;
  md5: string;
  expiresAt: Date;
}

export interface Period { start: Date; end: Date }

export interface PaymentRepository {
  getMembership(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null>;
  /** An open checkout for the same purchase: same plan in the workspace, or same pack by the same buyer. */
  findReusablePending(workspaceId: string, createdBy: string, purchase: Purchase, validUntil: Date): Promise<PaymentRecord | null>;
  create(payment: NewPayment): Promise<PaymentRecord>;
  get(paymentId: string): Promise<PaymentRecord | null>;
  listPending(limit: number): Promise<PaymentRecord[]>;
  markChecked(paymentId: string, checkedAt: Date): Promise<void>;
  /** Moves a PENDING payment to EXPIRED or FAILED; a payment in any other state is left alone. */
  close(paymentId: string, status: 'EXPIRED' | 'FAILED', reason: string | null): Promise<PaymentRecord | null>;
  /**
   * In one transaction: marks a PENDING payment PAID, moves the workspace subscription to the
   * period `nextPeriod` returns (plan payments only), and adds the payment's `creditUnits` to the
   * buyer's ledger. Returns the stored payment unchanged when it is already PAID.
   */
  activate(
    paymentId: string,
    transaction: { hash: string; payerAccountId: string; paidAt: Date },
    nextPeriod: ((current: SubscriptionRecord | null) => Period) | null,
  ): Promise<PaymentRecord>;
  /**
   * Adds the credits of PAID payments whose ledger grant is missing. Plan credits expire
   * when `planCreditsExpireAt` says. Returns how many were granted.
   */
  grantMissingCredits(limit: number, planCreditsExpireAt: (payment: { plan: string | null; paidAt: Date | null }) => Date | null): Promise<number>;
  getSubscription(workspaceId: string): Promise<SubscriptionRecord | null>;
  getCreditBalance(userId: string): Promise<number>;
}

export interface PaymentGateway {
  checkTransactionByMd5(md5: string): Promise<TransactionLookup>;
}

export interface PaymentServiceOptions {
  /** The plan catalog, from PLAN_* settings. A price change applies to new checkouts only. */
  plans: readonly BillingPlan[];
  /** The credit packs on sale, from CREDIT_PACKS. */
  creditPacks: readonly CreditPack[];
  receiverAccountId: string;
  generateKhqr: (payment: KhqrPaymentRequest) => Khqr;
  qrTtlMs: number;
  /** Status reads within this window reuse the last Bakong answer instead of calling Bakong again. */
  minCheckIntervalMs?: number;
  /** How long past `expiresAt` a payment stays PENDING, for a payer who scanned just before expiry. */
  expiryGraceMs?: number;
  now?: () => Date;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Set in BAKONG_MODE=sandbox: the gateway whose results `simulatePayment` decides. */
  sandbox?: {
    simulate(md5: string, outcome: SandboxOutcome, expected: { amount: number; currency: string; toAccountId: string }): void;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REUSE_MIN_REMAINING_MS = 60_000;

/** Same plan while still active extends the current period; anything else starts a fresh one at payment time. */
export function nextSubscriptionPeriod(current: SubscriptionRecord | null, plan: PlanId, paidAt: Date, periodDays: number): Period {
  if (current && current.plan === plan && current.currentPeriodEnd > paidAt) {
    return { start: current.currentPeriodStart, end: new Date(current.currentPeriodEnd.getTime() + periodDays * DAY_MS) };
  }
  return { start: paidAt, end: new Date(paidAt.getTime() + periodDays * DAY_MS) };
}

export function createBillNumber() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  return `MTF-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

function toMinor(amount: number, currency: string) {
  return currency.toUpperCase() === 'KHR' ? Math.round(amount) : Math.round(amount * 100);
}

export class PaymentService {
  private readonly now: () => Date;
  private readonly minCheckIntervalMs: number;
  private readonly expiryGraceMs: number;

  constructor(
    private readonly repository: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly options: PaymentServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.minCheckIntervalMs = options.minCheckIntervalMs ?? 3_000;
    this.expiryGraceMs = options.expiryGraceMs ?? 2 * 60_000;
  }

  listPlans() {
    return this.options.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.priceCents / 100,
      currency: plan.currency,
      periodDays: plan.periodDays,
      credits: plan.credits,
      available: plan.available,
    }));
  }

  listCreditPacks() {
    return this.options.creditPacks.map((pack) => ({
      id: pack.id, price: pack.priceCents / 100, currency: pack.currency, credits: pack.credits,
    }));
  }

  async getSubscription(userId: string, workspaceId: string) {
    await this.requireMembership(workspaceId, userId);
    return this.subscriptionView(await this.repository.getSubscription(workspaceId));
  }

  /**
   * Opens a KHQR checkout. A plan is bought for the workspace by an owner; a credit pack
   * is bought by any member, and its credits go to that member.
   */
  async createCheckout(userId: string, workspaceId: string, purchase: Purchase) {
    const membership = await this.requireMembership(workspaceId, userId);
    const item = this.resolvePurchase(purchase);
    if (item.kind === 'PLAN' && membership.role !== 'owner') {
      throw new AppError(403, 'FORBIDDEN', 'Only workspace owners can buy a plan.');
    }

    const now = this.now();
    const reusable = await this.repository.findReusablePending(workspaceId, userId, purchase, new Date(now.getTime() + REUSE_MIN_REMAINING_MS));
    if (reusable) return this.paymentView(reusable);

    const billNumber = createBillNumber();
    const expiresAt = new Date(now.getTime() + this.options.qrTtlMs);
    const khqr = this.options.generateKhqr({
      amount: item.priceCents / 100, currency: item.currency, billNumber, expiresAt, storeLabel: item.storeLabel,
    });
    const payment = await this.repository.create({
      workspaceId, createdBy: userId, kind: item.kind, plan: item.plan, creditPack: item.creditPack, creditUnits: item.creditUnits,
      amountMinor: item.priceCents, currency: item.currency, billNumber, qr: khqr.qr, md5: khqr.md5, expiresAt,
    });
    this.options.logger?.info({ paymentId: payment.id, workspaceId, kind: item.kind, plan: item.plan, creditPack: item.creditPack }, 'Bakong checkout created');
    return this.paymentView(payment);
  }

  /** Returns the payment, asking Bakong first when it is still PENDING. */
  async getPayment(userId: string, paymentId: string) {
    const stored = await this.repository.get(paymentId);
    if (!stored || !(await this.repository.getMembership(stored.workspaceId, userId))) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
    }
    const payment = await this.refresh(stored);
    const paid = payment.status === 'PAID';
    const subscription = paid && payment.kind === 'PLAN' ? await this.repository.getSubscription(payment.workspaceId) : null;
    // Credits belong to the buyer, so only the buyer sees their balance here.
    const creditBalance = paid && payment.createdBy === userId ? (await this.repository.getCreditBalance(userId)) / CREDIT_SCALE : null;
    return { ...this.paymentView(payment), subscription: subscription ? this.subscriptionView(subscription) : null, creditBalance };
  }

  /**
   * Sandbox only: plays the payer's bank for an open checkout, then settles it through the
   * same path a real payment takes (matching, plan activation, credit grant).
   */
  async simulatePayment(userId: string, paymentId: string, outcome: SandboxOutcome | 'expired') {
    if (!this.options.sandbox) throw new AppError(404, 'NOT_FOUND', 'Route not found.');
    const stored = await this.repository.get(paymentId);
    if (!stored || !(await this.repository.getMembership(stored.workspaceId, userId))) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
    }
    if (stored.status !== 'PENDING') throw new AppError(409, 'PAYMENT_NOT_PENDING', `This payment is already ${stored.status}.`);
    if (outcome === 'expired') {
      await this.repository.close(stored.id, 'EXPIRED', 'Expired in the sandbox.');
    } else {
      this.options.sandbox.simulate(stored.md5, outcome, {
        amount: stored.amountMinor / 100, currency: stored.currency, toAccountId: this.options.receiverAccountId,
      });
      await this.refresh(stored, true);
    }
    return this.getPayment(userId, paymentId);
  }

  /** Checks every PENDING payment once; run on an interval so a closed checkout tab still activates the plan. */
  async reconcilePending(limit = 50) {
    const pending = await this.repository.listPending(limit);
    let paid = 0;
    for (const payment of pending) {
      if ((await this.refresh(payment)).status === 'PAID') paid += 1;
    }
    // Normally a no-op: activation grants credits in its own transaction. This fills in
    // payments that were PAID before credits were granted, without calling Bakong.
    const credited = await this.repository.grantMissingCredits(limit, (payment) => {
      const plan = payment.plan ? this.findPlan(payment.plan as PlanId) : undefined;
      return payment.paidAt && plan ? new Date(payment.paidAt.getTime() + plan.periodDays * DAY_MS) : null;
    });
    if (credited) this.options.logger?.info({ credited }, 'Granted missing credits for paid payments');
    return { checked: pending.length, paid, credited };
  }

  private async refresh(payment: PaymentRecord, force = false): Promise<PaymentRecord> {
    if (payment.status !== 'PENDING') return payment;
    const now = this.now();
    if (!force && payment.lastCheckedAt && now.getTime() - payment.lastCheckedAt.getTime() < this.minCheckIntervalMs) return payment;

    let lookup: TransactionLookup;
    try {
      lookup = await this.gateway.checkTransactionByMd5(payment.md5);
    } catch (error) {
      // Leave the payment PENDING: an outage must not expire a payment that may have gone through.
      this.options.logger?.warn({ err: error, paymentId: payment.id }, 'Bakong transaction check failed');
      return payment;
    }
    await this.repository.markChecked(payment.id, now);

    if (lookup.status === 'PAID') {
      const { transaction } = lookup;
      const mismatch = this.findMismatch(payment, transaction);
      if (mismatch) {
        this.options.logger?.error({ paymentId: payment.id, hash: transaction.hash, mismatch }, 'Bakong transaction does not match payment');
        return await this.repository.close(payment.id, 'FAILED', mismatch) ?? payment;
      }
      let nextPeriod: ((current: SubscriptionRecord | null) => Period) | null = null;
      if (payment.kind === 'PLAN') {
        const plan = payment.plan ? this.findPlan(payment.plan) : undefined;
        if (!plan) throw new Error(`Unknown plan ${payment.plan} on payment ${payment.id}`);
        nextPeriod = (current) => nextSubscriptionPeriod(current, plan.id, now, plan.periodDays);
      }
      const activated = await this.repository.activate(
        payment.id, { hash: transaction.hash, payerAccountId: transaction.fromAccountId, paidAt: now }, nextPeriod,
      );
      this.options.logger?.info({
        paymentId: payment.id, workspaceId: payment.workspaceId, kind: payment.kind, plan: payment.plan, credits: payment.creditUnits / CREDIT_SCALE,
      }, 'Bakong payment settled');
      return activated;
    }
    if (lookup.status === 'FAILED') {
      return await this.repository.close(payment.id, 'FAILED', 'Bakong reported the transaction as failed.') ?? payment;
    }
    if (now.getTime() > payment.expiresAt.getTime() + this.expiryGraceMs) {
      return await this.repository.close(payment.id, 'EXPIRED', null) ?? payment;
    }
    return { ...payment, lastCheckedAt: now };
  }

  private findPlan(id: PlanId) {
    return this.options.plans.find((plan) => plan.id === id);
  }

  private resolvePurchase(purchase: Purchase) {
    if ('plan' in purchase) {
      const plan = this.findPlan(purchase.plan);
      if (!plan?.available) throw new AppError(409, 'PLAN_UNAVAILABLE', 'This plan cannot be bought yet.');
      return {
        kind: 'PLAN' as const, plan: plan.id, creditPack: null, creditUnits: plan.credits * CREDIT_SCALE,
        priceCents: plan.priceCents, currency: plan.currency, storeLabel: `Motify ${plan.name}`,
      };
    }
    const pack = this.options.creditPacks.find((candidate) => candidate.id === purchase.creditPack);
    if (!pack) throw new AppError(409, 'CREDIT_PACK_UNAVAILABLE', 'This credit pack is not on sale.');
    return {
      kind: 'CREDIT_PACK' as const, plan: null, creditPack: pack.id, creditUnits: pack.credits * CREDIT_SCALE,
      priceCents: pack.priceCents, currency: pack.currency, storeLabel: `Motify ${pack.credits} credits`,
    };
  }

  private findMismatch(payment: PaymentRecord, transaction: { toAccountId: string; currency: string; amount: number }) {
    if (transaction.toAccountId.trim().toLowerCase() !== this.options.receiverAccountId.trim().toLowerCase()) {
      return `Paid to ${transaction.toAccountId}, expected ${this.options.receiverAccountId}.`;
    }
    if (transaction.currency.toUpperCase() !== payment.currency) {
      return `Paid in ${transaction.currency}, expected ${payment.currency}.`;
    }
    if (toMinor(Number(transaction.amount), payment.currency) !== payment.amountMinor) {
      return `Paid ${transaction.amount} ${transaction.currency}, expected ${payment.amountMinor} minor units.`;
    }
    return null;
  }

  private paymentView(payment: PaymentRecord) {
    return {
      id: payment.id,
      workspaceId: payment.workspaceId,
      // 'sandbox' payments were settled by POST /v1/payments/:id/sandbox; no money moved.
      mode: this.options.sandbox ? 'sandbox' as const : 'live' as const,
      kind: payment.kind,
      plan: payment.plan,
      creditPack: payment.creditPack,
      // Credits this payment adds to the buyer once PAID.
      credits: payment.creditUnits / CREDIT_SCALE,
      amount: payment.currency === 'KHR' ? payment.amountMinor : payment.amountMinor / 100,
      currency: payment.currency,
      billNumber: payment.billNumber,
      status: payment.status,
      // The QR is only worth showing while it can still be paid.
      qr: payment.status === 'PENDING' ? payment.qr : null,
      expiresAt: payment.expiresAt.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  private subscriptionView(subscription: SubscriptionRecord | null) {
    if (!subscription) return { status: 'none' as const, plan: null, currentPeriodStart: null, currentPeriodEnd: null };
    return {
      status: subscription.currentPeriodEnd > this.now() ? 'active' as const : 'expired' as const,
      plan: subscription.plan,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    };
  }

  private async requireMembership(workspaceId: string, userId: string) {
    const membership = await this.repository.getMembership(workspaceId, userId);
    if (!membership) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return membership;
  }
}
