import { z } from 'zod';

import { normalizeDatabaseUrl } from '../../packages/database/connection-url.js';
import { DEFAULT_PERIOD_DAYS, DEFAULT_PLANS, PLAN_IDS, type BillingPlan } from '../services/billing-plans.js';

const booleanString = z.enum(['true', 'false']).optional().transform((value) => (value ?? 'false') === 'true');
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  API_PUBLIC_URL: z.url(),
  FRONTEND_ORIGINS: z.string().min(1),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('motify-assets'),
  SESSION_ENCRYPTION_KEY: z.string().refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    { message: 'SESSION_ENCRYPTION_KEY must encode exactly 32 bytes' },
  ),
  SESSION_COOKIE_SECURE: booleanString,
  LOG_LEVEL: logLevel,
  AI_PROVIDER: z.enum(['gemini', 'openai-compatible', 'anthropic', 'openrouter']).default('gemini'),
  AI_MODEL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
  OPENAI_COMPATIBLE_BASE_URL: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().min(1).optional(),
  OPENROUTER_SITE_URL: z.string().min(1).optional(),
  OPENROUTER_APP_NAME: z.string().min(1).optional(),
  MOTIFY_AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(200).default(50),
  MOTIFY_AGENT_MAX_VALIDATION_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  MOTIFY_AGENT_CONTEXT_TOKENS: z.coerce.number().int().min(8000).max(1_000_000).default(32_000),
  KIRITTS_MCP_URL: z.string().min(1).optional(),
  KIRITTS_ACCESS_TOKEN: z.string().min(1).optional(),
  SIGNUP_CREDITS: z.coerce.number().min(0).max(1000).default(50),
  // Off until real usage has been compared with the pricing; then metering only logs.
  CREDITS_ENFORCED: booleanString,
  AI_INPUT_PRICE_PER_MTOK: z.coerce.number().positive().default(2),
  AI_OUTPUT_PRICE_PER_MTOK: z.coerce.number().positive().default(10),
  CREDIT_USD_VALUE: z.coerce.number().positive().default(0.0416),
  CREDIT_MIN_CHARGE: z.coerce.number().positive().default(0.5),
  CREDIT_MAX_CHARGE: z.coerce.number().positive().default(30),
  CREDIT_RESERVE: z.coerce.number().positive().default(10),
  GENERATION_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
  BAKONG_API_BASE_URL: z.url().default('https://api-bakong.nbc.gov.kh'),
  BAKONG_TOKEN: z.string().min(1).optional(),
  BAKONG_ACCOUNT_ID: z.string().regex(/^[^@\s]+@[^@\s]+$/, 'BAKONG_ACCOUNT_ID must look like name@bank').max(32).optional(),
  BAKONG_MERCHANT_NAME: z.string().trim().min(1).max(25).default('Motify'),
  BAKONG_MERCHANT_CITY: z.string().trim().min(1).max(15).default('Phnom Penh'),
  BAKONG_MERCHANT_ID: z.string().min(1).max(32).optional(),
  BAKONG_ACQUIRING_BANK: z.string().min(1).max(32).optional(),
  BAKONG_QR_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(180),
  BAKONG_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3_600).default(30),
});

const planPrice = z.coerce.number().min(0.01).max(10_000).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
  { message: 'must be in USD with at most 2 decimal places' },
);

// PLAN_<ID>_NAME / _PRICE / _CREDITS / _AVAILABLE per plan; unset values keep DEFAULT_PLANS.
const planSchema = z.object({
  BILLING_PERIOD_DAYS: z.coerce.number().int().min(1).max(366).default(DEFAULT_PERIOD_DAYS),
  ...Object.fromEntries(PLAN_IDS.flatMap((id) => {
    const prefix = `PLAN_${id.toUpperCase()}`;
    const defaults = DEFAULT_PLANS[id];
    return [
      // "Motify <name>" is the KHQR store label, which allows 25 characters.
      [`${prefix}_NAME`, z.string().trim().min(1).max(18).default(defaults.name)],
      [`${prefix}_PRICE`, planPrice.default(defaults.priceCents / 100)],
      [`${prefix}_CREDITS`, z.coerce.number().int().min(0).max(1_000_000).default(defaults.credits)],
      [`${prefix}_AVAILABLE`, z.enum(['true', 'false']).default(defaults.available ? 'true' : 'false')],
    ];
  })),
});

export function parseBillingPlans(source: NodeJS.ProcessEnv | Record<string, string | undefined>): BillingPlan[] {
  const parsed = planSchema.parse(source) as Record<string, string | number>;
  return PLAN_IDS.map((id) => {
    const prefix = `PLAN_${id.toUpperCase()}`;
    return {
      id,
      name: parsed[`${prefix}_NAME`] as string,
      priceCents: Math.round((parsed[`${prefix}_PRICE`] as number) * 100),
      currency: 'USD' as const,
      periodDays: parsed.BILLING_PERIOD_DAYS as number,
      credits: parsed[`${prefix}_CREDITS`] as number,
      available: parsed[`${prefix}_AVAILABLE`] === 'true',
    };
  });
}

export function parseEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const parsed = schema.parse(source);
  if (parsed.NODE_ENV === 'production' && !parsed.SESSION_COOKIE_SECURE) {
    throw new Error('SESSION_COOKIE_SECURE must be true in production');
  }
  if (Boolean(parsed.BAKONG_TOKEN) !== Boolean(parsed.BAKONG_ACCOUNT_ID)) {
    throw new Error('BAKONG_TOKEN and BAKONG_ACCOUNT_ID must be set together to enable Bakong payments');
  }
  if (Boolean(parsed.BAKONG_MERCHANT_ID) !== Boolean(parsed.BAKONG_ACQUIRING_BANK)) {
    throw new Error('BAKONG_MERCHANT_ID and BAKONG_ACQUIRING_BANK must be set together');
  }
  const frontendOrigins = parsed.FRONTEND_ORIGINS.split(',').map((origin) => {
    const normalized = origin.trim().replace(/\/$/, '');
    return new URL(normalized).origin;
  });
  return {
    nodeEnv: parsed.NODE_ENV,
    apiHost: parsed.API_HOST,
    apiPort: parsed.API_PORT,
    apiPublicUrl: parsed.API_PUBLIC_URL.replace(/\/$/, ''),
    frontendOrigins,
    databaseUrl: parsed.DATABASE_URL,
    supabaseUrl: deriveSupabaseUrl(parsed.DATABASE_URL),
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageBucket: parsed.SUPABASE_STORAGE_BUCKET,
    sessionEncryptionKey: parsed.SESSION_ENCRYPTION_KEY,
    secureCookies: parsed.SESSION_COOKIE_SECURE,
    logLevel: parsed.LOG_LEVEL,
    aiProvider: parsed.AI_PROVIDER,
    aiModel: parsed.AI_MODEL,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    anthropicBaseUrl: parsed.ANTHROPIC_BASE_URL,
    geminiApiKey: parsed.GEMINI_API_KEY,
    openAiCompatibleApiKey: parsed.OPENAI_COMPATIBLE_API_KEY,
    openAiCompatibleBaseUrl: parsed.OPENAI_COMPATIBLE_BASE_URL,
    openRouterApiKey: parsed.OPENROUTER_API_KEY,
    openRouterBaseUrl: parsed.OPENROUTER_BASE_URL,
    openRouterSiteUrl: parsed.OPENROUTER_SITE_URL,
    openRouterAppName: parsed.OPENROUTER_APP_NAME,
    motifyAgentMaxSteps: parsed.MOTIFY_AGENT_MAX_STEPS,
    motifyAgentMaxValidationRetries: parsed.MOTIFY_AGENT_MAX_VALIDATION_RETRIES,
    motifyAgentContextTokens: parsed.MOTIFY_AGENT_CONTEXT_TOKENS,
    kiriTtsUrl: parsed.KIRITTS_MCP_URL,
    kiriTtsAccessToken: parsed.KIRITTS_ACCESS_TOKEN,
    // Whole hundredths of a credit, the unit balances are stored in.
    signupCreditUnits: Math.round(parsed.SIGNUP_CREDITS * 100),
    creditsEnforced: parsed.CREDITS_ENFORCED,
    creditPricing: {
      inputUsdPerMillionTokens: parsed.AI_INPUT_PRICE_PER_MTOK,
      outputUsdPerMillionTokens: parsed.AI_OUTPUT_PRICE_PER_MTOK,
      usdPerCredit: parsed.CREDIT_USD_VALUE,
      minChargeUnits: Math.round(parsed.CREDIT_MIN_CHARGE * 100),
      maxChargeUnits: Math.round(parsed.CREDIT_MAX_CHARGE * 100),
      // A call with no reported usage is priced as one average generation.
      unreportedChargeUnits: Math.round(parsed.CREDIT_RESERVE * 100),
    },
    creditHoldUnits: Math.round(parsed.CREDIT_RESERVE * 100),
    creditMinUnits: Math.round(parsed.CREDIT_MIN_CHARGE * 100),
    generationMaxActivePerUser: parsed.GENERATION_MAX_ACTIVE_PER_USER,
    billingPlans: parseBillingPlans(source),
    bakong: parsed.BAKONG_TOKEN && parsed.BAKONG_ACCOUNT_ID ? {
      apiBaseUrl: parsed.BAKONG_API_BASE_URL.replace(/\/$/, ''),
      token: parsed.BAKONG_TOKEN,
      accountId: parsed.BAKONG_ACCOUNT_ID,
      merchantName: parsed.BAKONG_MERCHANT_NAME,
      merchantCity: parsed.BAKONG_MERCHANT_CITY,
      merchantId: parsed.BAKONG_MERCHANT_ID,
      acquiringBank: parsed.BAKONG_ACQUIRING_BANK,
      qrTtlSeconds: parsed.BAKONG_QR_TTL_SECONDS,
      reconcileIntervalSeconds: parsed.BAKONG_RECONCILE_INTERVAL_SECONDS,
    } : null,
  };
}

function deriveSupabaseUrl(databaseUrl: string): string {
  const connection = new URL(normalizeDatabaseUrl(databaseUrl));
  const directMatch = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(connection.hostname);
  if (directMatch?.[1]) return `https://${directMatch[1]}.supabase.co`;

  if (connection.hostname.endsWith('.pooler.supabase.com')) {
    const poolerUserMatch = /^postgres\.([a-z0-9-]+)$/i.exec(decodeURIComponent(connection.username));
    if (poolerUserMatch?.[1]) return `https://${poolerUserMatch[1]}.supabase.co`;
  }

  throw new Error('DATABASE_URL must be a Supabase direct or session-pooler connection string');
}

export type Environment = ReturnType<typeof parseEnvironment>;
