import { describe, expect, it, vi } from 'vitest';

import { GenerationBilling, type BillingOptions, type CreditLedger } from '../../../src/services/generation-billing.js';
import type { CreditPricing } from '../../../src/services/credit-pricing.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

const pricing: CreditPricing = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
  usdPerCredit: 0.0416,
  minChargeUnits: 50,
  maxChargeUnits: 3_000,
  unreportedChargeUnits: 1_000,
};

const options: BillingOptions = { enforced: true, holdUnits: 1_000, minUnits: 50, staleAfterMs: 900_000 };

function ledger(overrides: Partial<CreditLedger> = {}) {
  return {
    reserve: vi.fn().mockResolvedValue({ held: 1_000, balance: 4_000 }),
    settle: vi.fn().mockResolvedValue({ charged: 337, balance: 4_663 }),
    refund: vi.fn().mockResolvedValue({ refunded: 1_000 }),
    releaseStaleHolds: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function billing(l = ledger(), opts: Partial<BillingOptions> = {}, log = logger()) {
  return { billing: new GenerationBilling(l, pricing, { ...options, ...opts }, 'test-model', log), ledger: l, log };
}

describe('GenerationBilling', () => {
  describe('when enforced', () => {
    it('holds an average generation before any model is called', async () => {
      const { billing: b, ledger: l } = billing();
      const hold = await b.begin(USER_ID);
      expect(l.reserve).toHaveBeenCalledWith(USER_ID, hold.referenceId, { holdUnits: 1_000, minUnits: 50 });
    });

    it('refuses with 402 and the balance when the account cannot cover a request', async () => {
      const { billing: b } = billing(ledger({ reserve: vi.fn().mockResolvedValue({ held: 0, balance: 20 }) }));
      await expect(b.begin(USER_ID)).rejects.toMatchObject({
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        details: { balance: 0.2, required: 0.5 },
      });
    });

    it('charges the real cost from the tokens the request used, and reports what is left', async () => {
      const { billing: b, ledger: l } = billing();
      const hold = await b.begin(USER_ID);
      hold.meter.record(30_000, 8_000);

      await expect(b.complete(hold)).resolves.toEqual({ charged: 3.37, remaining: 46.63 });
      expect(l.settle).toHaveBeenCalledWith(USER_ID, hold.referenceId, {
        costUnits: 337, inputTokens: 30_000, outputTokens: 8_000, model: 'test-model',
      });
    });

    it('does not lose the user their result when settling fails', async () => {
      const { billing: b, log } = billing(ledger({ settle: vi.fn().mockRejectedValue(new Error('db down')) }));
      const hold = await b.begin(USER_ID);
      hold.meter.record(30_000, 8_000);

      await expect(b.complete(hold)).resolves.toBeUndefined();
      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ error: 'db down' }), expect.stringContaining('hold will be released'));
    });

    it('returns the whole hold when a request gives the user nothing', async () => {
      const { billing: b, ledger: l } = billing();
      const hold = await b.begin(USER_ID);
      hold.meter.record(150_000, 50_000);

      await b.abandon(hold);
      expect(l.refund).toHaveBeenCalledWith(USER_ID, hold.referenceId);
      expect(l.settle).not.toHaveBeenCalled();
    });

    it('never throws from abandon, so the original error still reaches the user', async () => {
      const { billing: b, log } = billing(ledger({ refund: vi.fn().mockRejectedValue(new Error('db down')) }));
      const hold = await b.begin(USER_ID);
      await expect(b.abandon(hold)).resolves.toBeUndefined();
      expect(log.error).toHaveBeenCalled();
    });

    it('warns when a provider reported no usage and prices it conservatively', async () => {
      const { billing: b, ledger: l, log } = billing();
      const hold = await b.begin(USER_ID);
      hold.meter.record(null, null);

      await b.complete(hold);
      expect(l.settle).toHaveBeenCalledWith(USER_ID, hold.referenceId, expect.objectContaining({ costUnits: 1_000 }));
      expect(log.warn).toHaveBeenCalled();
    });

    it('releases holds that nothing settled, using the stale cutoff', async () => {
      const { billing: b, ledger: l } = billing(ledger({ releaseStaleHolds: vi.fn().mockResolvedValue(2) }));
      const now = new Date('2026-09-29T12:00:00.000Z');
      await expect(b.releaseStale(now)).resolves.toBe(2);
      expect(l.releaseStaleHolds).toHaveBeenCalledWith(new Date('2026-09-29T11:45:00.000Z'));
    });
  });

  describe('when not enforced', () => {
    it('meters and logs what it would charge but never touches a balance', async () => {
      const { billing: b, ledger: l, log } = billing(ledger(), { enforced: false });
      const hold = await b.begin(USER_ID);
      hold.meter.record(30_000, 8_000);

      await expect(b.complete(hold)).resolves.toBeUndefined();
      await b.abandon(hold);
      await expect(b.releaseStale()).resolves.toBe(0);

      expect(l.reserve).not.toHaveBeenCalled();
      expect(l.settle).not.toHaveBeenCalled();
      expect(l.refund).not.toHaveBeenCalled();
      expect(l.releaseStaleHolds).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ credits: 3.37, inputTokens: 30_000, outputTokens: 8_000 }),
        expect.stringContaining('would have charged'),
      );
    });

    it('lets an account with no credits generate', async () => {
      const { billing: b } = billing(ledger({ reserve: vi.fn().mockResolvedValue({ held: 0, balance: 0 }) }), { enforced: false });
      await expect(b.begin(USER_ID)).resolves.toBeDefined();
    });
  });
});
