import { randomUUID } from 'node:crypto';

import { UsageMeter } from '../../packages/ai/usage/usage-meter.js';
import { AppError } from '../errors.js';
import { priceUsage, type CreditPricing } from './credit-pricing.js';
import { toCredits } from './credit.service.js';

export interface ReserveResult {
  /** Hundredths of a credit taken as a hold. Zero means the account cannot cover a request. */
  held: number;
  /** Balance after the hold, or the current balance when nothing was held. */
  balance: number;
}

export interface SettleInput {
  costUnits: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface SettleResult {
  /** Hundredths of a credit this request cost in the end. */
  charged: number;
  balance: number;
}

/** The write side of credits. Balances only ever move through these calls. */
export interface CreditLedger {
  reserve(userId: string, referenceId: string, hold: { holdUnits: number; minUnits: number }): Promise<ReserveResult>;
  settle(userId: string, referenceId: string, input: SettleInput): Promise<SettleResult>;
  refund(userId: string, referenceId: string): Promise<{ refunded: number }>;
  releaseStaleHolds(olderThan: Date): Promise<number>;
}

export interface BillingOptions {
  /**
   * Off, requests are metered and logged as if they were charged but no balance
   * moves. Use it to check real usage against the pricing before charging anyone.
   */
  enforced: boolean;
  /** Held while a request runs, in hundredths of a credit: an average generation. */
  holdUnits: number;
  /** Fewest credits an account needs to start a request, in hundredths. */
  minUnits: number;
  /** A hold nothing settled for this long is given back. Longer than any request can run. */
  staleAfterMs: number;
}

export interface BillingLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/** An open charge for one request, from `begin` until `complete` or `abandon`. */
export interface GenerationHold {
  readonly userId: string;
  readonly referenceId: string;
  readonly meter: UsageMeter;
}

export interface GenerationCharge {
  /** Credits this request cost. */
  charged: number;
  /** Credits left afterwards. */
  remaining: number;
}

/**
 * Charges a generation for the tokens it really used, and gives the credits
 * back when the user got nothing.
 *
 * `begin` holds credits before any model is called, so a balance cannot be
 * spent twice by requests that overlap. Then exactly one of `complete` (charge
 * the real cost, return the rest of the hold) or `abandon` (return all of it)
 * closes the hold, and a hold nobody closes is swept up by `releaseStale`.
 */
export class GenerationBilling {
  constructor(
    private readonly ledger: CreditLedger,
    private readonly pricing: CreditPricing,
    private readonly options: BillingOptions,
    private readonly model: string,
    private readonly logger?: BillingLogger,
  ) {}

  async begin(userId: string): Promise<GenerationHold> {
    const hold: GenerationHold = { userId, referenceId: randomUUID(), meter: new UsageMeter() };
    if (!this.options.enforced) return hold;

    const reserved = await this.ledger.reserve(userId, hold.referenceId, {
      holdUnits: this.options.holdUnits,
      minUnits: this.options.minUnits,
    });
    if (reserved.held === 0) {
      throw new AppError(
        402,
        'INSUFFICIENT_CREDITS',
        'You do not have enough credits for this request.',
        { balance: toCredits(reserved.balance), required: toCredits(this.options.minUnits) },
      );
    }
    return hold;
  }

  /**
   * Charges for a request that produced a result. It never throws: the user
   * already has their film, and a bookkeeping failure must not take it away.
   * The hold is then given back by `releaseStale` rather than charged.
   */
  async complete(hold: GenerationHold): Promise<GenerationCharge | undefined> {
    const usage = hold.meter.snapshot();
    const priced = priceUsage(usage, this.pricing);
    const context = {
      userId: hold.userId, referenceId: hold.referenceId, model: this.model, ...usage,
      credits: toCredits(priced.units), costUsd: Number(priced.usd.toFixed(6)),
    };
    if (usage.unreportedCalls > 0) this.logger?.warn(context, 'Model calls reported no token usage; priced conservatively');
    if (!this.options.enforced) {
      this.logger?.info(context, 'Credits (not enforced): would have charged');
      return undefined;
    }
    try {
      const settled = await this.ledger.settle(hold.userId, hold.referenceId, {
        costUnits: priced.units, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, model: this.model,
      });
      this.logger?.info({ ...context, charged: toCredits(settled.charged) }, 'Credits charged');
      return { charged: toCredits(settled.charged), remaining: toCredits(settled.balance) };
    } catch (error) {
      this.logger?.error({ ...context, error: errorMessage(error) }, 'Could not settle credits; the hold will be released');
      return undefined;
    }
  }

  /** Returns the whole hold for a request that gave the user nothing. Never throws. */
  async abandon(hold: GenerationHold): Promise<void> {
    if (!this.options.enforced) return;
    try {
      const { refunded } = await this.ledger.refund(hold.userId, hold.referenceId);
      this.logger?.info(
        { userId: hold.userId, referenceId: hold.referenceId, refunded: toCredits(refunded), ...hold.meter.snapshot() },
        'Credits refunded: request produced nothing',
      );
    } catch (error) {
      this.logger?.error(
        { userId: hold.userId, referenceId: hold.referenceId, error: errorMessage(error) },
        'Could not refund credits; the hold will be released',
      );
    }
  }

  /** Gives back holds that were never settled. Safe to run on a timer. */
  async releaseStale(now: Date = new Date()): Promise<number> {
    if (!this.options.enforced) return 0;
    const released = await this.ledger.releaseStaleHolds(new Date(now.getTime() - this.options.staleAfterMs));
    if (released > 0) this.logger?.warn({ released }, 'Released credit holds that were never settled');
    return released;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
