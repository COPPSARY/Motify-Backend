import { randomUUID } from 'node:crypto';

import { TransactionRollbackError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../../packages/database/client.js';
import { users, workspaceMembers, workspaces } from '../../packages/database/schema.js';
import { DatabasePaymentRepository } from '../../src/repositories/payment.repository.js';
import { nextSubscriptionPeriod } from '../../src/services/payment.service.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('DatabasePaymentRepository', () => {
  it('stores a checkout, activates it once and extends the subscription', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const suffix = randomUUID();
    const userId = randomUUID();
    const workspaceId = randomUUID();

    try {
      await expect(db.transaction(async (transaction) => {
        await transaction.insert(users).values({ id: userId, email: `billing-${suffix}@example.com`, displayName: 'Billing Owner' });
        await transaction.insert(workspaces).values({ id: workspaceId, name: 'Billing', slug: `billing-${suffix}`, kind: 'team', ownerId: userId });
        await transaction.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
        const repository = new DatabasePaymentRepository(transaction as unknown as Database);

        const expiresAt = new Date(Date.now() + 10 * 60_000);
        const newPayment = (bill: string) => ({
          workspaceId, createdBy: userId, plan: 'pro' as const, amountMinor: 2_000, currency: 'USD' as const,
          billNumber: `MTF-${bill}-${suffix.slice(0, 6)}`, qr: `qr-${bill}-${suffix}`, md5: `md5-${bill}-${suffix}`, expiresAt,
        });
        const created = await repository.create(newPayment('A'));
        expect(created).toMatchObject({ status: 'PENDING', amountMinor: 2_000, lastCheckedAt: null });
        await expect(repository.findReusablePending(workspaceId, 'pro', new Date())).resolves.toMatchObject({ id: created.id });
        await expect(repository.findReusablePending(workspaceId, 'pro', new Date(expiresAt.getTime() + 1))).resolves.toBeNull();
        await expect(repository.getMembership(workspaceId, userId)).resolves.toEqual({ role: 'owner' });

        const paidAt = new Date();
        const period = (current: Parameters<typeof nextSubscriptionPeriod>[0]) => nextSubscriptionPeriod(current, 'pro', paidAt, 30);
        const paid = await repository.activate(created.id, { hash: `hash-A-${suffix}`, payerAccountId: 'payer@abaa', paidAt }, period);
        expect(paid).toMatchObject({ status: 'PAID' });
        const firstEnd = (await repository.getSubscription(workspaceId))!.currentPeriodEnd;

        // A second settle of the same payment must not extend the period again.
        await repository.activate(created.id, { hash: `hash-A-${suffix}`, payerAccountId: 'payer@abaa', paidAt }, period);
        expect((await repository.getSubscription(workspaceId))!.currentPeriodEnd).toEqual(firstEnd);
        await expect(repository.close(created.id, 'EXPIRED', null)).resolves.toBeNull();

        const renewal = await repository.create(newPayment('B'));
        await repository.activate(renewal.id, { hash: `hash-B-${suffix}`, payerAccountId: 'payer@abaa', paidAt }, period);
        const renewed = await repository.getSubscription(workspaceId);
        expect(renewed!.currentPeriodEnd.getTime() - firstEnd.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

        const abandoned = await repository.create(newPayment('C'));
        await repository.markChecked(abandoned.id, paidAt);
        await expect(repository.close(abandoned.id, 'EXPIRED', null)).resolves.toMatchObject({ status: 'EXPIRED' });
        expect((await repository.listPending(50)).map((payment) => payment.id)).not.toContain(abandoned.id);

        transaction.rollback();
      })).rejects.toBeInstanceOf(TransactionRollbackError);
    } finally {
      await pool.end();
    }
  });
});
