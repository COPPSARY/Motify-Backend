import { and, asc, desc, eq, gt } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { payments, workspaceMembers, workspaceSubscriptions } from '../../packages/database/schema.js';
import type { PlanId } from '../services/billing-plans.js';
import type { NewPayment, PaymentRecord, PaymentRepository, Period, SubscriptionRecord } from '../services/payment.service.js';

const paymentColumns = {
  id: payments.id,
  workspaceId: payments.workspaceId,
  plan: payments.plan,
  amountMinor: payments.amountMinor,
  currency: payments.currency,
  billNumber: payments.billNumber,
  qr: payments.qr,
  md5: payments.md5,
  status: payments.status,
  expiresAt: payments.expiresAt,
  lastCheckedAt: payments.lastCheckedAt,
  paidAt: payments.paidAt,
  createdAt: payments.createdAt,
};

const subscriptionColumns = {
  workspaceId: workspaceSubscriptions.workspaceId,
  plan: workspaceSubscriptions.plan,
  currentPeriodStart: workspaceSubscriptions.currentPeriodStart,
  currentPeriodEnd: workspaceSubscriptions.currentPeriodEnd,
};

export class DatabasePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Database) {}

  async getMembership(workspaceId: string, userId: string) {
    const [membership] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
    return membership ?? null;
  }

  async findReusablePending(workspaceId: string, plan: PlanId, validUntil: Date): Promise<PaymentRecord | null> {
    const [payment] = await this.db.select(paymentColumns).from(payments).where(and(
      eq(payments.workspaceId, workspaceId), eq(payments.plan, plan), eq(payments.status, 'PENDING'), gt(payments.expiresAt, validUntil),
    )).orderBy(desc(payments.createdAt)).limit(1);
    return payment ?? null;
  }

  async create(payment: NewPayment): Promise<PaymentRecord> {
    const [created] = await this.db.insert(payments).values(payment).returning(paymentColumns);
    if (!created) throw new Error('Unable to create payment');
    return created;
  }

  async get(paymentId: string): Promise<PaymentRecord | null> {
    const [payment] = await this.db.select(paymentColumns).from(payments).where(eq(payments.id, paymentId)).limit(1);
    return payment ?? null;
  }

  async listPending(limit: number): Promise<PaymentRecord[]> {
    return this.db.select(paymentColumns).from(payments).where(eq(payments.status, 'PENDING'))
      .orderBy(asc(payments.createdAt)).limit(limit);
  }

  async markChecked(paymentId: string, checkedAt: Date) {
    await this.db.update(payments).set({ lastCheckedAt: checkedAt }).where(eq(payments.id, paymentId));
  }

  async close(paymentId: string, status: 'EXPIRED' | 'FAILED', reason: string | null): Promise<PaymentRecord | null> {
    const [payment] = await this.db.update(payments).set({ status, failureReason: reason, updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING'))).returning(paymentColumns);
    return payment ?? null;
  }

  async activate(
    paymentId: string,
    transaction: { hash: string; payerAccountId: string; paidAt: Date },
    nextPeriod: (current: SubscriptionRecord | null) => Period,
  ): Promise<PaymentRecord> {
    return this.db.transaction(async (tx) => {
      // Row locks serialize a checkout poll and the background sweep settling the same payment.
      const [payment] = await tx.select(paymentColumns).from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!payment) throw new Error(`Payment ${paymentId} not found`);
      if (payment.status !== 'PENDING') return payment;

      const [paid] = await tx.update(payments).set({
        status: 'PAID', paidAt: transaction.paidAt, bakongHash: transaction.hash, payerAccountId: transaction.payerAccountId, updatedAt: new Date(),
      }).where(eq(payments.id, paymentId)).returning(paymentColumns);
      if (!paid) throw new Error(`Payment ${paymentId} could not be marked paid`);

      const [current] = await tx.select(subscriptionColumns).from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, payment.workspaceId)).for('update');
      const period = nextPeriod(current ?? null);
      const values = {
        plan: payment.plan, currentPeriodStart: period.start, currentPeriodEnd: period.end, lastPaymentId: paymentId, updatedAt: new Date(),
      };
      await tx.insert(workspaceSubscriptions).values({ workspaceId: payment.workspaceId, ...values })
        .onConflictDoUpdate({ target: workspaceSubscriptions.workspaceId, set: values });
      return paid;
    });
  }

  async getSubscription(workspaceId: string): Promise<SubscriptionRecord | null> {
    const [subscription] = await this.db.select(subscriptionColumns).from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId)).limit(1);
    return subscription ?? null;
  }
}
