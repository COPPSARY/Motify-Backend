import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';

import type { Database as DatabaseClient } from '../../packages/database/client.js';
import { creditAccounts, creditLedger, payments, workspaceMembers, workspaceSubscriptions } from '../../packages/database/schema.js';
import type {
  NewPayment, PaymentKind, PaymentRecord, PaymentRepository, Period, Purchase, SubscriptionRecord,
} from '../services/payment.service.js';

type Database = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];


const paymentColumns = {
  id: payments.id,
  workspaceId: payments.workspaceId,
  createdBy: payments.createdBy,
  kind: payments.kind,
  plan: payments.plan,
  creditPack: payments.creditPack,
  creditUnits: payments.creditUnits,
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

/** The ledger kind a payment's credits are recorded under. */
function grantKind(kind: PaymentKind) {
  return kind === 'PLAN' ? 'PLAN_GRANT' as const : 'PACK_PURCHASE' as const;
}

/**
 * Adds a paid payment's credits to its buyer. The ledger's unique (reference_id, kind) index
 * makes this a no-op for a payment already credited, so it is safe to run more than once.
 */
async function grantPaymentCredits(
  db: Pick<DatabaseClient, 'insert'>,
  payment: { id: string; createdBy: string; kind: PaymentKind; creditUnits: number; plan: string | null; creditPack: string | null },
  /** When plan credits expire: the end of the period they were bought for. Pack credits never expire. */
  expiresAt: Date | null,
) {
  if (payment.creditUnits <= 0) return false;
  await db.insert(creditAccounts).values({ userId: payment.createdBy }).onConflictDoNothing();
  const inserted = await db.insert(creditLedger).values({
    userId: payment.createdBy,
    kind: grantKind(payment.kind),
    amount: payment.creditUnits,
    referenceType: 'payment',
    referenceId: payment.id,
    note: payment.kind === 'PLAN' ? `${payment.plan} plan` : `${payment.creditPack}`,
    expiresAt: payment.kind === 'PLAN' ? expiresAt : null,
  }).onConflictDoNothing().returning({ id: creditLedger.id });
  return inserted.length > 0;
}

export class DatabasePaymentRepository implements PaymentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getMembership(workspaceId: string, userId: string) {
    const [membership] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
    return membership ?? null;
  }

  async findReusablePending(workspaceId: string, createdBy: string, purchase: Purchase, validUntil: Date): Promise<PaymentRecord | null> {
    const item = 'plan' in purchase
      ? and(eq(payments.kind, 'PLAN'), eq(payments.plan, purchase.plan))
      : and(eq(payments.kind, 'CREDIT_PACK'), eq(payments.creditPack, purchase.creditPack), eq(payments.createdBy, createdBy));
    const [payment] = await this.db.select(paymentColumns).from(payments).where(and(
      eq(payments.workspaceId, workspaceId), item, eq(payments.status, 'PENDING'), gt(payments.expiresAt, validUntil),
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
    nextPeriod: ((current: SubscriptionRecord | null) => Period) | null,
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

      let creditsExpireAt: Date | null = null;
      if (payment.kind === 'PLAN' && payment.plan && nextPeriod) {
        const [current] = await tx.select(subscriptionColumns).from(workspaceSubscriptions)
          .where(eq(workspaceSubscriptions.workspaceId, payment.workspaceId)).for('update');
        const period = nextPeriod(current ? { ...current, plan: current.plan } : null);
        const values = {
          plan: payment.plan, currentPeriodStart: period.start, currentPeriodEnd: period.end, lastPaymentId: paymentId, updatedAt: new Date(),
        };
        await tx.insert(workspaceSubscriptions).values({ workspaceId: payment.workspaceId, ...values })
          .onConflictDoUpdate({ target: workspaceSubscriptions.workspaceId, set: values });
        creditsExpireAt = period.end;
      }
      await grantPaymentCredits(tx, payment, creditsExpireAt);
      return paid;
    });
  }

  async grantMissingCredits(limit: number, planCreditsExpireAt: (payment: { plan: string | null; paidAt: Date | null }) => Date | null): Promise<number> {
    const missing = await this.db.select({
      id: payments.id, createdBy: payments.createdBy, kind: payments.kind, creditUnits: payments.creditUnits,
      plan: payments.plan, creditPack: payments.creditPack, paidAt: payments.paidAt,
    }).from(payments).where(and(
      eq(payments.status, 'PAID'),
      gt(payments.creditUnits, 0),
      sql`not exists (select 1 from ${creditLedger} where ${creditLedger.referenceId} = ${payments.id}
        and ${creditLedger.kind} = case ${payments.kind} when 'PLAN' then 'PLAN_GRANT'::credit_entry_kind else 'PACK_PURCHASE'::credit_entry_kind end)`,
    )).orderBy(asc(payments.paidAt)).limit(limit);
    let granted = 0;
    for (const payment of missing) {
      const expiresAt = payment.kind === 'PLAN' ? planCreditsExpireAt(payment) : null;
      if (await this.db.transaction((tx) => grantPaymentCredits(tx, payment, expiresAt))) granted += 1;
    }
    return granted;
  }

  async getCreditBalance(userId: string) {
    const [account] = await this.db.select({ balance: creditAccounts.balance }).from(creditAccounts)
      .where(eq(creditAccounts.userId, userId)).limit(1);
    return account?.balance ?? 0;
  }

  async getSubscription(workspaceId: string): Promise<SubscriptionRecord | null> {
    const [subscription] = await this.db.select(subscriptionColumns).from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId)).limit(1);
    return subscription ?? null;
  }
}
