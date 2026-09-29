import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../../packages/database/client.js';
import { creditLedger, users, workspaces } from '../../packages/database/schema.js';
import { DatabaseAccountProvisioner } from '../../src/repositories/auth.repository.js';
import { DatabaseCreditRepository } from '../../src/repositories/credit.repository.js';
import { CreditService } from '../../src/services/credit.service.js';

const databaseUrl = process.env.DATABASE_URL;

const HOLD = { holdUnits: 1_000, minUnits: 50 };

async function withUser<T>(
  startingUnits: number,
  run: (context: { db: Database; repository: DatabaseCreditRepository; userId: string }) => Promise<T>,
): Promise<T> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(databaseUrl);
  const userId = randomUUID();
  try {
    await new DatabaseAccountProvisioner(db, startingUnits).provision({
      id: userId,
      email: `ledger-${randomUUID()}@example.com`,
      emailVerified: true,
      displayName: 'Ledger Tester',
      avatarUrl: null,
    });
    return await run({ db, repository: new DatabaseCreditRepository(db), userId });
  } finally {
    await db.delete(workspaces).where(eq(workspaces.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  }
}

const settleInput = (costUnits: number) => ({ costUnits, inputTokens: 30_000, outputTokens: 8_000, model: 'test-model' });

/** What the ledger adds up to for one user; it must always equal the balance. */
async function ledgerTotal(db: Database, userId: string) {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
    .from(creditLedger).where(eq(creditLedger.userId, userId));
  return row?.total ?? 0;
}

describe.skipIf(!databaseUrl)('charging credits', () => {
  it('holds an average generation, or all that is left if that is less', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      await expect(repository.reserve(userId, randomUUID(), HOLD)).resolves.toEqual({ held: 1_000, balance: 4_000 });
    });
    await withUser(600, async ({ repository, userId }) => {
      await expect(repository.reserve(userId, randomUUID(), HOLD)).resolves.toEqual({ held: 600, balance: 0 });
    });
  });

  it('refuses a request when the balance is below the minimum, and holds nothing', async () => {
    await withUser(40, async ({ db, repository, userId }) => {
      await expect(repository.reserve(userId, randomUUID(), HOLD)).resolves.toEqual({ held: 0, balance: 40 });
      await expect(repository.getBalance(userId)).resolves.toBe(40);
      await expect(ledgerTotal(db, userId)).resolves.toBe(40);
    });
  });

  it('cannot spend the same credits twice when requests overlap', async () => {
    await withUser(2_500, async ({ db, repository, userId }) => {
      const results = await Promise.all(Array.from({ length: 10 }, () => repository.reserve(userId, randomUUID(), HOLD)));
      const held = results.map((result) => result.held).sort((a, b) => b - a);

      // Two full holds and one for what remained; the rest are refused.
      expect(held).toEqual([1_000, 1_000, 500, 0, 0, 0, 0, 0, 0, 0]);
      await expect(repository.getBalance(userId)).resolves.toBe(0);
      await expect(ledgerTotal(db, userId)).resolves.toBe(0);
    });
  });

  it('charges the real cost when it is below the hold, giving back the rest', async () => {
    await withUser(5_000, async ({ db, repository, userId }) => {
      const reference = randomUUID();
      await repository.reserve(userId, reference, HOLD);

      await expect(repository.settle(userId, reference, settleInput(337))).resolves.toEqual({ charged: 337, balance: 4_663 });
      await expect(repository.getBalance(userId)).resolves.toBe(4_663);
      await expect(ledgerTotal(db, userId)).resolves.toBe(4_663);

      const [settled] = await db.select().from(creditLedger).where(eq(creditLedger.referenceId, reference)).then(
        (rows) => rows.filter((row) => row.kind === 'SETTLE'),
      );
      expect(settled).toMatchObject({ amount: 663, inputTokens: 30_000, outputTokens: 8_000, model: 'test-model' });
    });
  });

  it('charges the overrun too when the cost is above the hold and the balance covers it', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      const reference = randomUUID();
      await repository.reserve(userId, reference, HOLD);
      await expect(repository.settle(userId, reference, settleInput(1_924))).resolves.toEqual({ charged: 1_924, balance: 3_076 });
    });
  });

  it('takes only what is left when the cost is above what the account has', async () => {
    await withUser(1_200, async ({ db, repository, userId }) => {
      const reference = randomUUID();
      await repository.reserve(userId, reference, HOLD);
      await expect(repository.settle(userId, reference, settleInput(3_000))).resolves.toEqual({ charged: 1_200, balance: 0 });
      await expect(repository.getBalance(userId)).resolves.toBe(0);
      await expect(ledgerTotal(db, userId)).resolves.toBe(0);
    });
  });

  it('closes a hold whose cost exactly matched it, so it is not later given back', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      const reference = randomUUID();
      await repository.reserve(userId, reference, HOLD);
      await expect(repository.settle(userId, reference, settleInput(1_000))).resolves.toEqual({ charged: 1_000, balance: 4_000 });
      await expect(repository.releaseStaleHolds(new Date(Date.now() + 60_000))).resolves.toBe(0);
      await expect(repository.getBalance(userId)).resolves.toBe(4_000);
    });
  });

  it('returns the whole hold on a refund', async () => {
    await withUser(5_000, async ({ db, repository, userId }) => {
      const reference = randomUUID();
      await repository.reserve(userId, reference, HOLD);
      await expect(repository.refund(userId, reference)).resolves.toEqual({ refunded: 1_000 });
      await expect(repository.getBalance(userId)).resolves.toBe(5_000);
      await expect(ledgerTotal(db, userId)).resolves.toBe(5_000);
    });
  });

  it('closes a hold once: no double charge, no double refund, no refund after a charge', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      const charged = randomUUID();
      await repository.reserve(userId, charged, HOLD);
      await repository.settle(userId, charged, settleInput(337));
      await expect(repository.settle(userId, charged, settleInput(337))).resolves.toMatchObject({ charged: 0 });
      await expect(repository.refund(userId, charged)).resolves.toEqual({ refunded: 0 });
      await expect(repository.getBalance(userId)).resolves.toBe(4_663);

      const refunded = randomUUID();
      await repository.reserve(userId, refunded, HOLD);
      await repository.refund(userId, refunded);
      await expect(repository.refund(userId, refunded)).resolves.toEqual({ refunded: 0 });
      await expect(repository.settle(userId, refunded, settleInput(337))).resolves.toMatchObject({ charged: 0 });
      await expect(repository.getBalance(userId)).resolves.toBe(4_663);
    });
  });

  it('ignores a settle or refund for a hold that was never made', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      await expect(repository.settle(userId, randomUUID(), settleInput(337))).resolves.toMatchObject({ charged: 0 });
      await expect(repository.refund(userId, randomUUID())).resolves.toEqual({ refunded: 0 });
      await expect(repository.getBalance(userId)).resolves.toBe(5_000);
    });
  });

  it("cannot be used to close or read another user's hold", async () => {
    await withUser(5_000, async ({ repository, userId: owner }) => {
      await withUser(5_000, async ({ repository: other, userId: stranger }) => {
        const reference = randomUUID();
        await repository.reserve(owner, reference, HOLD);
        await expect(other.refund(stranger, reference)).resolves.toEqual({ refunded: 0 });
        await expect(other.settle(stranger, reference, settleInput(1))).resolves.toMatchObject({ charged: 0 });
        await expect(other.getBalance(stranger)).resolves.toBe(5_000);
        await expect(repository.getBalance(owner)).resolves.toBe(4_000);
      });
    });
  });

  it('gives back a hold that nothing ever settled, but only once it is old enough', async () => {
    await withUser(5_000, async ({ db, repository, userId }) => {
      const abandoned = randomUUID();
      await db.insert(creditLedger).values({
        userId, kind: 'RESERVE', amount: -1_000, referenceType: 'generation', referenceId: abandoned,
        createdAt: new Date(Date.now() - 30 * 60_000),
      });
      const running = randomUUID();
      await repository.reserve(userId, running, HOLD);
      await expect(repository.getBalance(userId)).resolves.toBe(3_000);

      await expect(repository.releaseStaleHolds(new Date(Date.now() - 15 * 60_000))).resolves.toBe(1);
      await expect(repository.getBalance(userId)).resolves.toBe(4_000);

      // A late settle for the swept hold does not charge or credit anything.
      await expect(repository.settle(userId, abandoned, settleInput(337))).resolves.toMatchObject({ charged: 0 });
      await expect(repository.getBalance(userId)).resolves.toBe(4_000);
      await expect(ledgerTotal(db, userId)).resolves.toBe(4_000);
    });
  });

  it('shows one line per request in history, with its net cost', async () => {
    await withUser(5_000, async ({ repository, userId }) => {
      const charged = randomUUID();
      await repository.reserve(userId, charged, HOLD);
      await repository.settle(userId, charged, settleInput(337));
      const failed = randomUUID();
      await repository.reserve(userId, failed, HOLD);
      await repository.refund(userId, failed);

      const history = await new CreditService(repository).listHistory(userId, { limit: 10 });
      expect(history.entries.map((entry) => [entry.kind, entry.amount, entry.description])).toEqual([
        ['REFUND', 0, 'Not charged (generation failed)'],
        ['SETTLE', -3.37, 'Generation'],
        ['SIGNUP_GRANT', 50, 'Welcome credits'],
      ]);
      expect(history.nextCursor).toBeNull();
    });
  });

  it('pages history over grouped entries without repeating or skipping any', async () => {
    await withUser(50_000, async ({ repository, userId }) => {
      for (let index = 0; index < 5; index += 1) {
        const reference = randomUUID();
        await repository.reserve(userId, reference, HOLD);
        await repository.settle(userId, reference, settleInput(337 + index));
      }
      const service = new CreditService(repository);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await service.listHistory(userId, { limit: 2, cursor });
        seen.push(...page.entries.map((entry) => entry.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
    });
  });
});
