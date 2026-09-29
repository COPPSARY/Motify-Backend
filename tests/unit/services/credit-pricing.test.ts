import { describe, expect, it } from 'vitest';

import { priceUsage, type CreditPricing } from '../../../src/services/credit-pricing.js';

const pricing: CreditPricing = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
  usdPerCredit: 0.0416,
  minChargeUnits: 50,
  maxChargeUnits: 3_000,
  unreportedChargeUnits: 1_000,
};

const usage = (inputTokens: number, outputTokens: number, unreportedCalls = 0) => ({
  inputTokens, outputTokens, calls: 1, unreportedCalls,
});

describe('priceUsage', () => {
  // The sheet's examples, in credits: chat 0.5, small edit 3.4, average 10, heavy film 19.2.
  it.each([
    ['a small edit', usage(30_000, 8_000), 337],
    ['an average generation', usage(80_648, 25_470), 1_000],
    ['a heavy new film', usage(150_000, 50_000), 1_924],
  ])('prices %s from its real tokens', (_name, tokens, units) => {
    expect(priceUsage(tokens, pricing).units).toBe(units);
  });

  it('matches the sheet formula, (input + 5 x output) / 20,800 credits', () => {
    const { units } = priceUsage(usage(100_000, 20_000), pricing);
    expect(units).toBe(Math.ceil(((100_000 + 5 * 20_000) / 20_800) * 100));
  });

  it('never charges less than the floor, even for a reply that cost almost nothing', () => {
    expect(priceUsage(usage(5_000, 1_000), pricing).units).toBe(50);
    expect(priceUsage(usage(0, 0), pricing).units).toBe(50);
  });

  it('never charges more than the ceiling, however long a repair loop ran', () => {
    expect(priceUsage(usage(2_000_000, 900_000), pricing).units).toBe(3_000);
  });

  it('rounds up, so a charge is never a fraction under the cost', () => {
    const exact = (1_000_000 * 2) / 1_000_000 / 0.0416 * 100; // 4807.69...
    expect(priceUsage(usage(1_000_000, 0), { ...pricing, maxChargeUnits: 1_000_000 }).units).toBe(Math.ceil(exact));
  });

  it('prices a call whose provider reported nothing as an average generation', () => {
    expect(priceUsage(usage(0, 0, 1), pricing).units).toBe(1_000);
    // But never below what the calls that did report already cost.
    expect(priceUsage(usage(150_000, 50_000, 1), pricing).units).toBe(1_924);
  });

  it('reports what the tokens cost in dollars', () => {
    expect(priceUsage(usage(1_000_000, 100_000), pricing).usd).toBeCloseTo(3, 10);
  });

  it('follows a price change without any other change', () => {
    const doubled = { ...pricing, inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 };
    // 336.5 units at the old price, rounded up to 337; 673.1 at double, rounded up to 674.
    expect(priceUsage(usage(30_000, 8_000), doubled).units).toBe(674);
  });
});
