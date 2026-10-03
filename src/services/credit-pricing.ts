import type { MeteredUsage } from '../../packages/ai/usage/usage-meter.js';
import { CREDIT_SCALE } from './credit.service.js';

export interface CreditPricing {
  /** What the configured model charges us, in USD per million tokens. */
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  /** Raw AI cost of one credit. Retries, refunds, render and storage are covered by the sale price, not here. */
  usdPerCredit: number;
  /** Least a message can cost, in hundredths of a credit. */
  minChargeUnits: number;
  /** Most a message can cost, in hundredths of a credit. */
  maxChargeUnits: number;
  /** Charged when a provider answered without reporting any tokens. */
  unreportedChargeUnits: number;
}

export interface PricedUsage {
  /** Hundredths of a credit. */
  units: number;
  /** What the tokens cost us. */
  usd: number;
}

/**
 * Turns what a request really spent into credits, so a one-line edit costs a
 * few credits and a full film costs about ten, whatever the prompt says.
 *
 * With the sheet's prices ($2 in, $10 out) and $0.0416 per credit this is
 * `(input + 5 * output) / 20,800` credits. It rounds up, so a charge is never
 * a fraction under the cost, then applies the floor and ceiling.
 */
export function priceUsage(usage: Omit<MeteredUsage, 'cachedInputTokens'>, pricing: CreditPricing): PricedUsage {
  const usd = (usage.inputTokens * pricing.inputUsdPerMillionTokens
    + usage.outputTokens * pricing.outputUsdPerMillionTokens) / 1_000_000;
  // Rounded to a millionth of a credit first, so float noise cannot tip a whole
  // number of units up by one.
  const exactUnits = Math.round((usd / pricing.usdPerCredit) * CREDIT_SCALE * 1e6) / 1e6;
  let units = Math.ceil(exactUnits);
  // A provider that answered but reported nothing cannot be priced; assume an average generation.
  if (usage.unreportedCalls > 0) units = Math.max(units, pricing.unreportedChargeUnits);
  return {
    units: Math.min(pricing.maxChargeUnits, Math.max(pricing.minChargeUnits, units)),
    usd,
  };
}
