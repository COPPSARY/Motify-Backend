import { randomUUID } from 'node:crypto';

import { eq, TransactionRollbackError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../../packages/database/client.js';
import { creditAccounts, creditGrants, creditLedger, users } from '../../packages/database/schema.js';
import { DatabaseCreditRepository } from '../../src/repositories/credit.repository.js';
import { CreditService } from '../../src/services/credit.service.js';

const databaseUrl = process.env.DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)('plan credit expiry', () => {
  it('spends the soonest-expiring credits first, refunds them back, and expires only what is left', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const userId = randomUUID();
    const now = new Date();
    const starterEnds = new Date(now.getTime() + 20 * DAY);
    const proEnds = new Date(now.getTime() + 29 * DAY);

    try {
      await expect(db.transaction(async (transaction) => {
        const repository = new DatabaseCreditRepository(transaction as unknown as Database);
        const credits = new CreditService(repository);
        const remaining = async () => (await transaction.select({ remaining: creditGrants.remaining, expiresAt: creditGrants.expiresAt })
          .from(creditGrants).where(eq(creditGrants.userId, userId)).orderBy(creditGrants.expiresAt))
          .map((grant) => grant.remaining);

        await transaction.insert(users).values({ id: userId, email: `expiry-${userId}@example.com`, displayName: 'Expiry' });
        await transaction.insert(creditAccounts).values({ userId });
        // 50 permanent signup credits, then Starter (150) and, after an upgrade, Pro (300).
        await transaction.insert(creditLedger).values([
          { userId, kind: 'SIGNUP_GRANT', amount: 5_000, referenceType: 'signup' },
          { userId, kind: 'PLAN_GRANT', amount: 15_000, referenceType: 'payment', referenceId: randomUUID(), expiresAt: starterEnds },
          { userId, kind: 'PLAN_GRANT', amount: 30_000, referenceType: 'payment', referenceId: randomUUID(), expiresAt: proEnds },
        ]);
        await expect(credits.getBalance(userId)).resolves.toEqual({
          balance: 500,
          permanent: 50,
          expiring: [{ credits: 150, expiresAt: starterEnds.toISOString() }, { credits: 300, expiresAt: proEnds.toISOString() }],
        });

        // A generation holds 120: all from Starter, which expires first. A failure refunds it there.
        const first = randomUUID();
        await repository.reserve(userId, first, { holdUnits: 12_000, minUnits: 50 });
        expect(await remaining()).toEqual([3_000, 30_000]);
        await repository.refund(userId, first);
        expect(await remaining()).toEqual([15_000, 30_000]);

        // A 200 hold empties Starter and takes 50 from Pro; it cost 160, so 40 comes back.
        const second = randomUUID();
        await repository.reserve(userId, second, { holdUnits: 20_000, minUnits: 50 });
        expect(await remaining()).toEqual([0, 25_000]);
        await repository.settle(userId, second, { costUnits: 16_000, inputTokens: 1, outputTokens: 1, model: 'test' });
        expect(await remaining()).toEqual([0, 29_000]);
        await expect(repository.getBalance(userId)).resolves.toBe(34_000);

        // Nothing is due yet; at Pro's end its 290 left expire and the 50 permanent stay.
        await expect(repository.expireCredits(now)).resolves.toBe(0);
        await repository.expireCredits(new Date(proEnds.getTime() + 1_000));
        expect(await remaining()).toEqual([0, 0]);
        await expect(credits.getBalance(userId)).resolves.toEqual({ balance: 50, permanent: 50, expiring: [] });
        await expect(repository.expireCredits(new Date(proEnds.getTime() + 2_000))).resolves.toBe(0);

        const history = await credits.listHistory(userId, { limit: 10 });
        // Rows written in one transaction share created_at, so look the entry up instead of relying on order.
        expect(history.entries.filter((entry) => entry.kind === 'EXPIRE')).toEqual([
          expect.objectContaining({ amount: -290, description: 'Plan credits expired' }),
        ]);

        // With no plan credits left, spending draws on permanent credits.
        await repository.reserve(userId, randomUUID(), { holdUnits: 1_000, minUnits: 50 });
        await expect(repository.getBalance(userId)).resolves.toBe(4_000);

        transaction.rollback();
      })).rejects.toBeInstanceOf(TransactionRollbackError);
    } finally {
      await pool.end();
    }
  }, 120_000);
});
