import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../packages/database/client.js';
import type { Database } from '../../packages/database/client.js';
import { creditAccounts, creditLedger, users, workspaces } from '../../packages/database/schema.js';
import { DatabaseAccountProvisioner } from '../../src/repositories/auth.repository.js';
import { DatabaseCreditRepository } from '../../src/repositories/credit.repository.js';
import { CreditService } from '../../src/services/credit.service.js';

const databaseUrl = process.env.DATABASE_URL;

function identity(suffix: string) {
  return {
    id: randomUUID(),
    email: `credits-${suffix}-${randomUUID()}@example.com`,
    emailVerified: true,
    displayName: 'Credit Tester',
    avatarUrl: null,
  };
}

/** Provisioning also makes a personal workspace, whose owner reference must go before the user. */
async function removeUsers(db: Database, ...ids: string[]) {
  for (const id of ids) {
    await db.delete(workspaces).where(eq(workspaces.ownerId, id));
    await db.delete(users).where(eq(users.id, id));
  }
}

describe.skipIf(!databaseUrl)('credits in the database', () => {
  it('grants signup credits exactly once, however often or concurrently an account is provisioned', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const user = identity('grant');
    try {
      const provisioner = new DatabaseAccountProvisioner(db, 5000);
      const repository = new DatabaseCreditRepository(db);

      await provisioner.provision(user);
      await expect(repository.getBalance(user.id)).resolves.toBe(5000);

      await provisioner.provision(user);
      await Promise.all([provisioner.provision(user), provisioner.provision(user), provisioner.provision(user)]);
      await expect(repository.getBalance(user.id)).resolves.toBe(5000);

      const entries = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ kind: 'SIGNUP_GRANT', amount: 5000 });
    } finally {
      await removeUsers(db, user.id);
      await pool.end();
    }
  });

  it('creates an empty account and no grant when the signup amount is zero', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const user = identity('zero');
    try {
      await new DatabaseAccountProvisioner(db, 0).provision(user);
      await expect(new DatabaseCreditRepository(db).getBalance(user.id)).resolves.toBe(0);
      await expect(db.select().from(creditLedger).where(eq(creditLedger.userId, user.id))).resolves.toHaveLength(0);
    } finally {
      await removeUsers(db, user.id);
      await pool.end();
    }
  });

  it('refuses to overspend, edit history, or change a balance without a ledger entry', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const user = identity('tamper');
    try {
      await new DatabaseAccountProvisioner(db, 5000).provision(user);

      await db.insert(creditLedger).values({ userId: user.id, kind: 'ADJUSTMENT', amount: -1000 });
      const repository = new DatabaseCreditRepository(db);
      await expect(repository.getBalance(user.id)).resolves.toBe(4000);

      await expect(db.insert(creditLedger).values({ userId: user.id, kind: 'ADJUSTMENT', amount: -4001 })).rejects.toThrow();
      await expect(repository.getBalance(user.id)).resolves.toBe(4000);

      await expect(db.update(creditLedger).set({ amount: 999_999 }).where(eq(creditLedger.userId, user.id))).rejects.toThrow();
      await expect(db.update(creditAccounts).set({ balance: -1 }).where(eq(creditAccounts.userId, user.id))).rejects.toThrow();

      const [total] = await db.select({ sum: sql<number>`sum(${creditLedger.amount})::int` }).from(creditLedger)
        .where(eq(creditLedger.userId, user.id));
      expect(total?.sum).toBe(4000);
    } finally {
      await removeUsers(db, user.id);
      await pool.end();
    }
  });

  it('cannot spend the same credits twice concurrently', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const user = identity('race');
    try {
      await new DatabaseAccountProvisioner(db, 5000).provision(user);
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () => db.insert(creditLedger).values({ userId: user.id, kind: 'ADJUSTMENT', amount: -1000 })),
      );
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(5);
      await expect(new DatabaseCreditRepository(db).getBalance(user.id)).resolves.toBe(0);
    } finally {
      await removeUsers(db, user.id);
      await pool.end();
    }
  });

  it('pages history newest first without repeating or skipping entries', async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const user = identity('history');
    try {
      await new DatabaseAccountProvisioner(db, 5000).provision(user);
      // One statement, so every row shares a created_at: the cursor must fall back to the id.
      await db.insert(creditLedger).values(
        Array.from({ length: 5 }, () => ({ userId: user.id, kind: 'ADJUSTMENT' as const, amount: -100 })),
      );

      const service = new CreditService(new DatabaseCreditRepository(db));
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await service.listHistory(user.id, { limit: 2, cursor });
        seen.push(...page.entries.map((entry) => entry.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
    } finally {
      await removeUsers(db, user.id);
      await pool.end();
    }
  });

  it("keeps one user's history out of another's", async () => {
    if (!databaseUrl) return;
    const { db, pool } = createDatabase(databaseUrl);
    const first = identity('a');
    const second = identity('b');
    try {
      const provisioner = new DatabaseAccountProvisioner(db, 5000);
      await provisioner.provision(first);
      await provisioner.provision(second);
      await db.insert(creditLedger).values({ userId: first.id, kind: 'ADJUSTMENT', amount: -2500 });

      const service = new CreditService(new DatabaseCreditRepository(db));
      await expect(service.getBalance(first.id)).resolves.toEqual({ balance: 25, permanent: 25, expiring: [] });
      await expect(service.getBalance(second.id)).resolves.toEqual({ balance: 50, permanent: 50, expiring: [] });
      const history = await service.listHistory(second.id, { limit: 20 });
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0]).toMatchObject({ kind: 'SIGNUP_GRANT', amount: 50 });
    } finally {
      await removeUsers(db, first.id, second.id);
      await pool.end();
    }
  });
});
