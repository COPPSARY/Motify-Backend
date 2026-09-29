export type PlanId = 'starter' | 'pro' | 'studio';

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

// Mirrors motify.video/pricing. Change prices here and on the pricing page together.
export const BILLING_PLANS: readonly BillingPlan[] = [
  { id: 'starter', name: 'Starter', priceCents: 1_000, currency: 'USD', periodDays: 30, credits: 150, available: true },
  { id: 'pro', name: 'Pro', priceCents: 2_000, currency: 'USD', periodDays: 30, credits: 300, available: true },
  { id: 'studio', name: 'Studio', priceCents: 5_000, currency: 'USD', periodDays: 30, credits: 750, available: false },
];

export const PLAN_IDS = ['starter', 'pro', 'studio'] as const satisfies readonly PlanId[];

export function findPlan(id: string): BillingPlan | undefined {
  return BILLING_PLANS.find((plan) => plan.id === id);
}
