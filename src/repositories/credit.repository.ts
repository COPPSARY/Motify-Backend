import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { creditAccounts, creditLedger } from '../../packages/database/schema.js';
import type { CreditLedgerRow, CreditReader } from '../services/credit.service.js';
import type { CreditLedger, ReserveResult, SettleInput, SettleResult } from '../services/generation-billing.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Every balance change goes through here as a ledger insert; the trigger from
 * migration 0014 moves the balance. Each operation locks the user's account row
 * first, so two requests from one user are handled one after the other and a
 * balance can never be spent twice.
 */
export class DatabaseCreditRepository implements CreditReader, CreditLedger {
  constructor(private readonly db: Database) {}

  async getBalance(userId: string) {
    const [account] = await this.db.select({ balance: creditAccounts.balance }).from(creditAccounts)
      .where(eq(creditAccounts.userId, userId)).limit(1);
    return account?.balance ?? 0;
  }

  /**
   * One entry per thing that happened, not per ledger row. A generation writes a
   * hold and then a settle or refund; the user sees a single line with its net
   * cost, so the bookkeeping behind it stays out of their history.
   */
  async listEntries(userId: string, page: Parameters<CreditReader['listEntries']>[1]): Promise<CreditLedgerRow[]> {
    const before = page.before;
    const result = await this.db.execute<{
      id: string; kind: CreditLedgerRow['kind']; amount: number; created_at: Date | string; cursor_at: string;
    }>(sql`
      select coalesce(reference_id, id) as id,
        case
          when bool_or(kind = 'SIGNUP_GRANT') then 'SIGNUP_GRANT'
          when bool_or(kind = 'PLAN_GRANT') then 'PLAN_GRANT'
          when bool_or(kind = 'PACK_PURCHASE') then 'PACK_PURCHASE'
          when bool_or(kind = 'REFUND') then 'REFUND'
          when bool_or(kind in ('RESERVE', 'SETTLE')) then 'SETTLE'
          else 'ADJUSTMENT'
        end as kind,
        sum(amount)::int as amount,
        max(created_at) as created_at,
        to_char(max(created_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from credit_ledger
      where user_id = ${userId}
      group by coalesce(reference_id, id)
      ${before ? sql`having (max(created_at), coalesce(reference_id, id)) < (${before.at}::timestamptz, ${before.id}::uuid)` : sql``}
      order by max(created_at) desc, coalesce(reference_id, id) desc
      limit ${page.limit}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      // A raw query returns timestamps as text, unlike a typed select.
      createdAt: new Date(row.created_at),
      cursorAt: row.cursor_at,
    }));
  }

  reserve(userId: string, referenceId: string, hold: { holdUnits: number; minUnits: number }): Promise<ReserveResult> {
    return this.db.transaction(async (transaction) => {
      const balance = await lockBalance(transaction, userId);
      if (balance === null || balance < hold.minUnits) return { held: 0, balance: balance ?? 0 };
      // Hold what the request is expected to cost, or all that is left if that is less.
      const held = Math.min(hold.holdUnits, balance);
      await transaction.insert(creditLedger).values({
        userId, kind: 'RESERVE', amount: -held, referenceType: 'generation', referenceId,
      });
      return { held, balance: balance - held };
    });
  }

  settle(userId: string, referenceId: string, input: SettleInput): Promise<SettleResult> {
    return this.db.transaction(async (transaction) => {
      const balance = await lockBalance(transaction, userId);
      const hold = await readHold(transaction, userId, referenceId);
      if (balance === null || !hold.reserved || hold.closed) return { charged: 0, balance: balance ?? 0 };

      // The hold already left the balance. Give back what the request did not
      // use, or take the overrun, but never more than the account has left.
      const surplus = hold.reserved - input.costUnits;
      const amount = surplus >= 0 ? surplus : -Math.min(-surplus, balance);
      await transaction.insert(creditLedger).values({
        userId,
        kind: 'SETTLE',
        amount,
        referenceType: 'generation',
        referenceId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        model: input.model,
      });
      return { charged: hold.reserved - amount, balance: balance + amount };
    });
  }

  refund(userId: string, referenceId: string): Promise<{ refunded: number }> {
    return this.db.transaction(async (transaction) => {
      await lockBalance(transaction, userId);
      const hold = await readHold(transaction, userId, referenceId);
      if (!hold.reserved || hold.closed) return { refunded: 0 };
      await transaction.insert(creditLedger).values({
        userId, kind: 'REFUND', amount: hold.reserved, referenceType: 'generation', referenceId,
      });
      return { refunded: hold.reserved };
    });
  }

  /** Gives back holds nothing ever settled, such as when the server stopped mid-request. */
  async releaseStaleHolds(olderThan: Date): Promise<number> {
    const stale = await this.db.execute<{ user_id: string; reference_id: string }>(sql`
      select r.user_id, r.reference_id from credit_ledger r
      where r.kind = 'RESERVE' and r.created_at < ${olderThan.toISOString()}::timestamptz
        and not exists (
          select 1 from credit_ledger x
          where x.user_id = r.user_id and x.reference_id = r.reference_id and x.kind in ('SETTLE', 'REFUND')
        )
      limit 100
    `);
    let released = 0;
    for (const row of stale.rows) {
      const { refunded } = await this.refund(row.user_id, row.reference_id);
      if (refunded > 0) released += 1;
    }
    return released;
  }
}

/** Locks the account row until the transaction ends. Null when the user has no account. */
async function lockBalance(transaction: Transaction, userId: string): Promise<number | null> {
  const result = await transaction.execute<{ balance: number }>(
    sql`select balance from credit_accounts where user_id = ${userId} for update`,
  );
  return result.rows[0]?.balance ?? null;
}

async function readHold(transaction: Transaction, userId: string, referenceId: string) {
  const result = await transaction.execute<{ kind: string; amount: number }>(sql`
    select kind, amount from credit_ledger where user_id = ${userId} and reference_id = ${referenceId}
  `);
  let reserved = 0;
  let closed = false;
  for (const row of result.rows) {
    if (row.kind === 'RESERVE') reserved -= row.amount;
    if (row.kind === 'SETTLE' || row.kind === 'REFUND') closed = true;
  }
  return { reserved, closed };
}
