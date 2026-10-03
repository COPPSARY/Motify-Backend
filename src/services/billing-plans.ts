export type PlanId = 'starter' | 'pro' | 'studio';

// Plan ids are a database enum (billing_plan); adding one needs a migration.
export const PLAN_IDS = ['starter', 'pro', 'studio'] as const satisfies readonly PlanId[];

export interface BillingPlan {
  id: PlanId;
  name: string;
  /** Price in cents. KHQR has no recurring charge, so each period is paid for with its own QR. */
  priceCents: number;
  currency: 'USD';
  periodDays: number;
  /** Advertised on the pricing page. Not granted yet: credit metering is a separate piece of work. */
  credits: number;
  available: boolean;
}

/**
 * Used for any PLAN_<ID>_* variable left unset. Prices, credits, names and
 * availability are configured per deployment in .env (see parseEnvironment);
 * keep the pricing page in step, or have it read GET /v1/billing/plans.
 */
export const DEFAULT_PLANS: Readonly<Record<PlanId, Omit<BillingPlan, 'id' | 'currency' | 'periodDays'>>> = {
  starter: { name: 'Starter', priceCents: 1_000, credits: 150, available: true },
  pro: { name: 'Pro', priceCents: 2_000, credits: 300, available: true },
  studio: { name: 'Studio', priceCents: 5_000, credits: 750, available: false },
};

export const DEFAULT_PERIOD_DAYS = 30;

export interface CreditPack {
  /** `credits-<n>`, from the credit amount, so it stays stable when packs are reordered. */
  id: string;
  priceCents: number;
  currency: 'USD';
  credits: number;
}

/** price:credits pairs, the format of CREDIT_PACKS. Mirrors the published credit pricing. */
export const DEFAULT_CREDIT_PACKS = '2.50:30,5:65,10:135,25:350,50:720,100:1450';
