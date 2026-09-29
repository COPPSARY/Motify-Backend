import { and, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { creditAccounts, creditLedger } from '../../packages/database/schema.js';
import type { CreditLedgerRow, CreditReader } from '../services/credit.service.js';

/** Read-only by design; balances change only through ledger inserts made by server code. */
export class DatabaseCreditRepository implements CreditReader {
  constructor(private readonly db: Database) {}

  async getBalance(userId: string) {
    const [account] = await this.db.select({ balance: creditAccounts.balance }).from(creditAccounts)
      .where(eq(creditAccounts.userId, userId)).limit(1);
    return account?.balance ?? 0;
  }

  async listEntries(userId: string, page: Parameters<CreditReader['listEntries']>[1]): Promise<CreditLedgerRow[]> {
    const before = page.before;
    return this.db.select({
      id: creditLedger.id,
      kind: creditLedger.kind,
      amount: creditLedger.amount,
      createdAt: creditLedger.createdAt,
      cursorAt: sql<string>`to_char(${creditLedger.createdAt} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(creditLedger).where(and(
      eq(creditLedger.userId, userId),
      before
        ? sql`(${creditLedger.createdAt}, ${creditLedger.id}) < (${before.at}::timestamptz, ${before.id}::uuid)`
        : undefined,
    )).orderBy(desc(creditLedger.createdAt), desc(creditLedger.id)).limit(page.limit);
  }
}
