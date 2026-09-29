import { describe, expect, it, vi } from 'vitest';

import {
  CreditService,
  decodeCursor,
  encodeCursor,
  type CreditLedgerRow,
} from '../../../src/services/credit.service.js';

const userId = '00000000-0000-4000-8000-000000000001';

function row(index: number, overrides: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: 'SIGNUP_GRANT',
    amount: 5000,
    createdAt: new Date(Date.UTC(2026, 0, index)),
    cursorAt: `2026-01-${String(index).padStart(2, '0')}T00:00:00.123456Z`,
    ...overrides,
  };
}

function cursorOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('CreditService', () => {
  it('reports the balance in credits, not stored hundredths', async () => {
    const reader = { getBalance: vi.fn().mockResolvedValue(5000), listEntries: vi.fn() };
    await expect(new CreditService(reader).getBalance(userId)).resolves.toEqual({ balance: 50 });
    expect(reader.getBalance).toHaveBeenCalledWith(userId);
  });

  it('keeps fractional credits exact', async () => {
    const reader = { getBalance: vi.fn().mockResolvedValue(337), listEntries: vi.fn() };
    await expect(new CreditService(reader).getBalance(userId)).resolves.toEqual({ balance: 3.37 });
  });

  it('maps ledger rows without exposing internals and pages with a cursor', async () => {
    const reader = {
      getBalance: vi.fn(),
      listEntries: vi.fn().mockResolvedValue([row(3), row(2, { kind: 'SETTLE', amount: -1000 }), row(1)]),
    };
    const page = await new CreditService(reader).listHistory(userId, { limit: 2 });

    expect(reader.listEntries).toHaveBeenCalledWith(userId, { limit: 3, before: undefined });
    expect(page.entries).toEqual([
      { id: row(3).id, kind: 'SIGNUP_GRANT', amount: 50, description: 'Welcome credits', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: row(2).id, kind: 'SETTLE', amount: -10, description: 'Generation', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string)).toEqual({ at: row(2).cursorAt, id: row(2).id });
  });

  it('returns no cursor on the last page', async () => {
    const reader = { getBalance: vi.fn(), listEntries: vi.fn().mockResolvedValue([row(1)]) };
    await expect(new CreditService(reader).listHistory(userId, { limit: 2 })).resolves.toMatchObject({ nextCursor: null });
  });

  it('resumes from a cursor it issued', async () => {
    const reader = { getBalance: vi.fn(), listEntries: vi.fn().mockResolvedValue([]) };
    const cursor = encodeCursor({ at: row(2).cursorAt, id: row(2).id });
    await new CreditService(reader).listHistory(userId, { limit: 5, cursor });
    expect(reader.listEntries).toHaveBeenCalledWith(userId, { limit: 6, before: { at: row(2).cursorAt, id: row(2).id } });
  });

  it.each([
    ['not base64 json', 'not-a-cursor'],
    ['wrong shape', cursorOf({ at: 'x', id: 'y' })],
    ['extra keys', cursorOf({ at: row(1).cursorAt, id: row(1).id, sql: '1=1' })],
    ['sql in a field', cursorOf({ at: "2026-01-01' or 1=1 --", id: row(1).id })],
  ])('refuses a forged cursor (%s) before touching the database', async (_name, cursor) => {
    const reader = { getBalance: vi.fn(), listEntries: vi.fn() };
    await expect(new CreditService(reader).listHistory(userId, { limit: 5, cursor })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_CURSOR',
    });
    expect(reader.listEntries).not.toHaveBeenCalled();
  });

  it('offers no way to change a balance', () => {
    const methods = Object.getOwnPropertyNames(CreditService.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['getBalance', 'listHistory']);
  });
});
