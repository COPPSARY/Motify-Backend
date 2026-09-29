import { z } from 'zod';

import { AppError } from '../errors.js';

/** Balances and ledger amounts are stored as whole hundredths of a credit. */
export const CREDIT_SCALE = 100;

export type CreditEntryKind = 'SIGNUP_GRANT' | 'RESERVE' | 'SETTLE' | 'REFUND' | 'ADJUSTMENT';

export interface CreditLedgerRow {
  id: string;
  kind: CreditEntryKind;
  /** Hundredths of a credit; positive adds credits. */
  amount: number;
  createdAt: Date;
  /** `createdAt` at full database precision, so a cursor never skips a row. */
  cursorAt: string;
}

export interface CreditCursor {
  at: string;
  id: string;
}

export interface CreditReader {
  getBalance(userId: string): Promise<number>;
  listEntries(userId: string, page: { limit: number; before?: CreditCursor | undefined }): Promise<CreditLedgerRow[]>;
}

/**
 * What a request is expected to cost, so the editor can show it before the
 * user sends one. Fixed for the deployment (it comes straight from the
 * billing config, not from tokenizing anything), so one value serves every
 * request: `typical` is what an average generation costs, `min` is the
 * fewest credits a request needs to be accepted at all, and `max` is the
 * most any single request can ever cost.
 */
export interface CreditEstimate {
  typical: number;
  min: number;
  max: number;
}

export interface CreditEntry {
  id: string;
  kind: CreditEntryKind;
  /** Credits, signed. */
  amount: number;
  description: string;
  createdAt: string;
}

const DESCRIPTIONS: Record<CreditEntryKind, string> = {
  SIGNUP_GRANT: 'Welcome credits',
  RESERVE: 'Held for a generation',
  SETTLE: 'Generation',
  REFUND: 'Not charged (generation failed)',
  ADJUSTMENT: 'Adjustment',
};

const cursorSchema = z.strictObject({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});

export function toCredits(units: number): number {
  return units / CREDIT_SCALE;
}

export function encodeCursor(cursor: CreditCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Cursors come from the client, so anything that is not exactly ours is refused. */
export function decodeCursor(value: string): CreditCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The history cursor is invalid.');
  }
}

/**
 * Read side of credits. There is deliberately no method here, or anywhere
 * reachable from a route, that changes a balance: credits move only through
 * server-side code that records a ledger entry, never on a client's say-so.
 */
export class CreditService {
  constructor(
    private readonly credits: CreditReader,
    /** Absent when credits are not being enforced: nothing is charged, so no estimate applies. */
    private readonly estimate?: CreditEstimate,
  ) {}

  async getBalance(userId: string): Promise<{ balance: number; estimate?: CreditEstimate }> {
    const balance = toCredits(await this.credits.getBalance(userId));
    return this.estimate ? { balance, estimate: this.estimate } : { balance };
  }

  async listHistory(
    userId: string,
    input: { limit: number; cursor?: string | undefined },
  ): Promise<{ entries: CreditEntry[]; nextCursor: string | null }> {
    const before = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await this.credits.listEntries(userId, { limit: input.limit + 1, before });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      entries: page.map((row) => ({
        id: row.id,
        kind: row.kind,
        amount: toCredits(row.amount),
        description: DESCRIPTIONS[row.kind],
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > input.limit && last ? encodeCursor({ at: last.cursorAt, id: last.id }) : null,
    };
  }
}
