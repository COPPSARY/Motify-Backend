import { randomBytes } from 'node:crypto';

import type { Logger } from 'pino';

import type { TransactionLookup } from '../../packages/bakong/client.js';
import type { Khqr, KhqrPaymentRequest } from '../../packages/bakong/khqr.js';
import { AppError } from '../errors.js';
import type { BillingPlan, PlanId } from './billing-plans.js';
import type { WorkspaceRole } from './workspace.service.js';

export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
export type PaymentCurrency = 'USD' | 'KHR';

export interface PaymentRecord {
  id: string;
  workspaceId: string;
  plan: PlanId;
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
  plan: PlanId;
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
  findReusablePending(workspaceId: string, plan: PlanId, validUntil: Date): Promise<PaymentRecord | null>;
  create(payment: NewPayment): Promise<PaymentRecord>;
  get(paymentId: string): Promise<PaymentRecord | null>;
  listPending(limit: number): Promise<PaymentRecord[]>;
  markChecked(paymentId: string, checkedAt: Date): Promise<void>;
  /** Moves a PENDING payment to EXPIRED or FAILED; a payment in any other state is left alone. */
  close(paymentId: string, status: 'EXPIRED' | 'FAILED', reason: string | null): Promise<PaymentRecord | null>;
  /**
   * Marks a PENDING payment PAID and moves the workspace subscription to the period `nextPeriod`
   * returns, in one transaction. Returns the stored payment unchanged when it is already PAID.
   */
  activate(
    paymentId: string,
    transaction: { hash: string; payerAccountId: string; paidAt: Date },
    nextPeriod: (current: SubscriptionRecord | null) => Period,
  ): Promise<PaymentRecord>;
  getSubscription(workspaceId: string): Promise<SubscriptionRecord | null>;
}

export interface PaymentGateway {
  checkTransactionByMd5(md5: string): Promise<TransactionLookup>;
}

export interface PaymentServiceOptions {
  /** The plan catalog, from PLAN_* settings. A price change applies to new checkouts only. */
  plans: readonly BillingPlan[];
  receiverAccountId: string;
  generateKhqr: (payment: KhqrPaymentRequest) => Khqr;
  qrTtlMs: number;
  /** Status reads within this window reuse the last Bakong answer instead of calling Bakong again. */
  minCheckIntervalMs?: number;
  /** How long past `expiresAt` a payment stays PENDING, for a payer who scanned just before expiry. */
  expiryGraceMs?: number;
  now?: () => Date;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
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

  async getSubscription(userId: string, workspaceId: string) {
    await this.requireMembership(workspaceId, userId);
    return this.subscriptionView(await this.repository.getSubscription(workspaceId));
  }

  async createCheckout(userId: string, workspaceId: string, planId: PlanId) {
    const membership = await this.requireMembership(workspaceId, userId);
    if (membership.role !== 'owner') throw new AppError(403, 'FORBIDDEN', 'Only workspace owners can buy a plan.');
    const plan = this.findPlan(planId);
    if (!plan?.available) throw new AppError(409, 'PLAN_UNAVAILABLE', 'This plan cannot be bought yet.');

    const now = this.now();
    const reusable = await this.repository.findReusablePending(workspaceId, plan.id, new Date(now.getTime() + REUSE_MIN_REMAINING_MS));
    if (reusable) return this.paymentView(reusable);

    const billNumber = createBillNumber();
    const expiresAt = new Date(now.getTime() + this.options.qrTtlMs);
    const khqr = this.options.generateKhqr({
      amount: plan.priceCents / 100, currency: plan.currency, billNumber, expiresAt, storeLabel: `Motify ${plan.name}`,
    });
    const payment = await this.repository.create({
      workspaceId, createdBy: userId, plan: plan.id, amountMinor: plan.priceCents, currency: plan.currency,
      billNumber, qr: khqr.qr, md5: khqr.md5, expiresAt,
    });
    this.options.logger?.info({ paymentId: payment.id, workspaceId, plan: plan.id }, 'Bakong checkout created');
    return this.paymentView(payment);
  }

  /** Returns the payment, asking Bakong first when it is still PENDING. */
  async getPayment(userId: string, paymentId: string) {
    const stored = await this.repository.get(paymentId);
    if (!stored || !(await this.repository.getMembership(stored.workspaceId, userId))) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
    }
    const payment = await this.refresh(stored);
    const subscription = payment.status === 'PAID' ? await this.repository.getSubscription(payment.workspaceId) : null;
    return { ...this.paymentView(payment), subscription: subscription ? this.subscriptionView(subscription) : null };
  }

  /** Checks every PENDING payment once; run on an interval so a closed checkout tab still activates the plan. */
  async reconcilePending(limit = 50) {
    const pending = await this.repository.listPending(limit);
    let paid = 0;
    for (const payment of pending) {
      if ((await this.refresh(payment)).status === 'PAID') paid += 1;
    }
    return { checked: pending.length, paid };
  }

  private async refresh(payment: PaymentRecord): Promise<PaymentRecord> {
    if (payment.status !== 'PENDING') return payment;
    const now = this.now();
    if (payment.lastCheckedAt && now.getTime() - payment.lastCheckedAt.getTime() < this.minCheckIntervalMs) return payment;

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
      const plan = this.findPlan(payment.plan);
      if (!plan) throw new Error(`Unknown plan ${payment.plan} on payment ${payment.id}`);
      const activated = await this.repository.activate(
        payment.id,
        { hash: transaction.hash, payerAccountId: transaction.fromAccountId, paidAt: now },
        (current) => nextSubscriptionPeriod(current, plan.id, now, plan.periodDays),
      );
      this.options.logger?.info({ paymentId: payment.id, workspaceId: payment.workspaceId, plan: plan.id }, 'Plan activated from Bakong payment');
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
      plan: payment.plan,
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
