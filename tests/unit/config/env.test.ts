import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '../../../src/config/env.js';

const valid = {
  NODE_ENV: 'production',
  API_HOST: '0.0.0.0',
  API_PORT: '4000',
  API_PUBLIC_URL: 'https://api.motify.example',
  FRONTEND_ORIGINS: 'https://motify.example',
  DATABASE_URL: 'postgresql://postgres.motifyref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  SUPABASE_STORAGE_BUCKET: 'motify-assets',
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  SESSION_COOKIE_SECURE: 'true',
  AI_MODEL: 'shared-provider-model',
};

describe('parseEnvironment', () => {
  it('rejects insecure production cookies', () => {
    expect(() => parseEnvironment({ ...valid, SESSION_COOKIE_SECURE: 'false' })).toThrow(
      'SESSION_COOKIE_SECURE',
    );
  });

  it('requires server-only Supabase Storage credentials in every environment', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _key, ...withoutServiceRole } = valid;
    expect(() => parseEnvironment(withoutServiceRole)).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(() => parseEnvironment({
      ...withoutServiceRole,
      NODE_ENV: 'development',
      SESSION_COOKIE_SECURE: 'false',
    })).toThrow('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('exposes only Supabase storage configuration', () => {
    const environment = parseEnvironment({
      ...valid,
      NODE_ENV: 'development',
      SESSION_COOKIE_SECURE: 'false',
      OBJECT_STORAGE_DRIVER: 'local',
      OBJECT_STORAGE_LOCAL_ROOT: './legacy-objects',
    });

    expect(environment.supabaseStorageBucket).toBe('motify-assets');
    expect(environment.supabaseServiceRoleKey).toBe('service-role-secret');
    expect(environment).not.toHaveProperty('objectStorageDriver');
    expect(environment).not.toHaveProperty('objectStorageLocalRoot');
  });

  it('parses an allow-list of frontend origins', () => {
    const environment = parseEnvironment({
      ...valid,
      FRONTEND_ORIGINS: 'https://motify.example,https://studio.motify.example',
    });

    expect(environment.frontendOrigins).toEqual([
      'https://motify.example',
      'https://studio.motify.example',
    ]);
  });

  it('derives the Supabase Auth URL from a session-pooler database URL', () => {
    const environment = parseEnvironment({
      ...valid,
      DATABASE_URL: 'postgresql://postgres.motifyref:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    });

    expect(environment.supabaseUrl).toBe('https://motifyref.supabase.co');
  });

  it('derives the Supabase Auth URL from a direct database URL', () => {
    const environment = parseEnvironment({
      ...valid,
      DATABASE_URL: 'postgresql://postgres:password@db.motifyref.supabase.co:5432/postgres',
    });

    expect(environment.supabaseUrl).toBe('https://motifyref.supabase.co');
  });

  it('rejects a removed OpenAI provider name', () => {
    expect(() => parseEnvironment({ ...valid, AI_PROVIDER: 'openai' })).toThrow();
  });

  it('parses the OpenAI-compatible provider, API key, and base URL', () => {
    const environment = parseEnvironment({
      ...valid,
      AI_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_API_KEY: 'openai-compatible-key',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.openai.com/v1',
    });

    expect(environment.aiProvider).toBe('openai-compatible');
    expect(environment.openAiCompatibleApiKey).toBe('openai-compatible-key');
    expect(environment.openAiCompatibleBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('uses AI_MODEL as the only configured model', () => {
    const environment = parseEnvironment({
      ...valid,
      AI_MODEL: 'shared-provider-model',
      GEMINI_MODEL: 'ignored-gemini-model',
    });

    expect(environment.aiModel).toBe('shared-provider-model');
    expect(environment).not.toHaveProperty('geminiModel');
  });

  it('requires AI_MODEL even when the removed GEMINI_MODEL is set', () => {
    const { AI_MODEL: _aiModel, ...withoutAiModel } = valid;
    expect(() => parseEnvironment({ ...withoutAiModel, GEMINI_MODEL: 'ignored-gemini-model' })).toThrow();
  });

  it('starts each account with 50 credits, stored in hundredths', () => {
    expect(parseEnvironment(valid).signupCreditUnits).toBe(5000);
    expect(parseEnvironment({ ...valid, SIGNUP_CREDITS: '12.5' }).signupCreditUnits).toBe(1250);
    expect(parseEnvironment({ ...valid, SIGNUP_CREDITS: '0' }).signupCreditUnits).toBe(0);
  });

  it('rejects a negative or absurd signup grant', () => {
    expect(() => parseEnvironment({ ...valid, SIGNUP_CREDITS: '-1' })).toThrow('SIGNUP_CREDITS');
    expect(() => parseEnvironment({ ...valid, SIGNUP_CREDITS: '1000000' })).toThrow('SIGNUP_CREDITS');
    expect(() => parseEnvironment({ ...valid, SIGNUP_CREDITS: 'lots' })).toThrow('SIGNUP_CREDITS');
  });

  it('leaves Bakong payments disabled until a token and account are set', () => {
    expect(parseEnvironment(valid).bakong).toBeNull();
    expect(() => parseEnvironment({ ...valid, BAKONG_TOKEN: 'token' })).toThrow('BAKONG_TOKEN and BAKONG_ACCOUNT_ID');
    expect(() => parseEnvironment({ ...valid, BAKONG_TOKEN: 'token', BAKONG_ACCOUNT_ID: 'not-an-account' })).toThrow('name@bank');
  });

  it('parses Bakong settings with KHQR-safe defaults', () => {
    const environment = parseEnvironment({ ...valid, BAKONG_TOKEN: 'token', BAKONG_ACCOUNT_ID: 'motify@aclb', BAKONG_API_BASE_URL: 'https://kh-proxy.motify.example/' });
    expect(environment.bakong).toEqual({
      mode: 'live',
      apiBaseUrl: 'https://kh-proxy.motify.example',
      token: 'token',
      accountId: 'motify@aclb',
      merchantName: 'Motify',
      merchantCity: 'Phnom Penh',
      merchantId: undefined,
      acquiringBank: undefined,
      qrTtlSeconds: 180,
      reconcileIntervalSeconds: 30,
    });
    expect(() => parseEnvironment({ ...valid, BAKONG_TOKEN: 'token', BAKONG_ACCOUNT_ID: 'motify@aclb', BAKONG_MERCHANT_NAME: 'M'.repeat(26) })).toThrow();
    expect(() => parseEnvironment({ ...valid, BAKONG_TOKEN: 'token', BAKONG_ACCOUNT_ID: 'motify@aclb', BAKONG_MERCHANT_ID: '1' })).toThrow('BAKONG_ACQUIRING_BANK');
  });

  it('leaves credits unenforced until asked, priced from the sheet by default', () => {
    const environment = parseEnvironment(valid);
    expect(environment.creditsEnforced).toBe(false);
    expect(environment.creditPricing).toEqual({
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 10,
      usdPerCredit: 0.0416,
      minChargeUnits: 50,
      maxChargeUnits: 3_000,
      unreportedChargeUnits: 1_000,
    });
    expect(environment.creditHoldUnits).toBe(1_000);
    expect(environment.creditMinUnits).toBe(50);
    expect(parseEnvironment({ ...valid, CREDITS_ENFORCED: 'true' }).creditsEnforced).toBe(true);
  });

  it('takes the model price and credit value from the environment', () => {
    const environment = parseEnvironment({
      ...valid, AI_INPUT_PRICE_PER_MTOK: '0.5', AI_OUTPUT_PRICE_PER_MTOK: '3', CREDIT_USD_VALUE: '0.05', CREDIT_MAX_CHARGE: '20',
    });
    expect(environment.creditPricing).toMatchObject({
      inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 3, usdPerCredit: 0.05, maxChargeUnits: 2_000,
    });
  });

  it('rejects a price of zero or less, which would make every generation free', () => {
    for (const name of ['AI_INPUT_PRICE_PER_MTOK', 'AI_OUTPUT_PRICE_PER_MTOK', 'CREDIT_USD_VALUE']) {
      expect(() => parseEnvironment({ ...valid, [name]: '0' })).toThrow(name);
    }
  });

  it('defaults the plan catalog to the published pricing', () => {
    expect(parseEnvironment(valid).billingPlans).toEqual([
      { id: 'starter', name: 'Starter', priceCents: 1_000, currency: 'USD', periodDays: 30, credits: 150, available: true },
      { id: 'pro', name: 'Pro', priceCents: 2_000, currency: 'USD', periodDays: 30, credits: 300, available: true },
      { id: 'studio', name: 'Studio', priceCents: 5_000, currency: 'USD', periodDays: 30, credits: 750, available: false },
    ]);
  });

  it('reads plan prices, credits, names and availability from settings', () => {
    const plans = parseEnvironment({
      ...valid,
      PLAN_STARTER_PRICE: '7.5', PLAN_PRO_CREDITS: '400', PLAN_PRO_NAME: 'Creator', PLAN_STUDIO_AVAILABLE: 'true', BILLING_PERIOD_DAYS: '31',
    }).billingPlans;
    expect(plans).toEqual([
      expect.objectContaining({ id: 'starter', priceCents: 750, periodDays: 31 }),
      expect.objectContaining({ id: 'pro', name: 'Creator', priceCents: 2_000, credits: 400 }),
      expect.objectContaining({ id: 'studio', available: true }),
    ]);
  });

  it('rejects plan settings a KHQR cannot carry', () => {
    expect(() => parseEnvironment({ ...valid, PLAN_PRO_PRICE: '0' })).toThrow('PLAN_PRO_PRICE');
    expect(() => parseEnvironment({ ...valid, PLAN_PRO_PRICE: '9.999' })).toThrow('2 decimal places');
    expect(() => parseEnvironment({ ...valid, PLAN_PRO_PRICE: 'free' })).toThrow('PLAN_PRO_PRICE');
    expect(() => parseEnvironment({ ...valid, PLAN_STARTER_NAME: 'A name far too long for KHQR' })).toThrow('PLAN_STARTER_NAME');
    expect(() => parseEnvironment({ ...valid, PLAN_STUDIO_AVAILABLE: 'yes' })).toThrow('PLAN_STUDIO_AVAILABLE');
    expect(() => parseEnvironment({ ...valid, BILLING_PERIOD_DAYS: '0' })).toThrow('BILLING_PERIOD_DAYS');
  });

  it('parses Kiri TTS and agent step-budget configuration', () => {
    const environment = parseEnvironment({ ...valid, MOTIFY_AGENT_MAX_STEPS: '25', KIRITTS_MCP_URL: 'https://mcp.kiritts.com/mcp', KIRITTS_ACCESS_TOKEN: 'token' });
    expect(environment.motifyAgentMaxSteps).toBe(25);
    expect(environment.kiriTtsUrl).toBe('https://mcp.kiritts.com/mcp');
  });

  it('defaults the agent memory budget to 32000 tokens and rejects a budget that is too small', () => {
    expect(parseEnvironment(valid).motifyAgentContextTokens).toBe(32_000);
    expect(parseEnvironment({ ...valid, MOTIFY_AGENT_CONTEXT_TOKENS: '20000' }).motifyAgentContextTokens).toBe(20_000);
    expect(() => parseEnvironment({ ...valid, MOTIFY_AGENT_CONTEXT_TOKENS: '7999' })).toThrow('MOTIFY_AGENT_CONTEXT_TOKENS');
  });

  it('defaults the agent step budget to 50 when unset', () => {
    const environment = parseEnvironment(valid);
    expect(environment.motifyAgentMaxSteps).toBe(50);
  });

  it('defaults to two retries when a film fails validation, and rejects a negative or huge number', () => {
    expect(parseEnvironment(valid).motifyAgentMaxValidationRetries).toBe(2);
    expect(parseEnvironment({ ...valid, MOTIFY_AGENT_MAX_VALIDATION_RETRIES: '0' }).motifyAgentMaxValidationRetries).toBe(0);
    expect(() => parseEnvironment({ ...valid, MOTIFY_AGENT_MAX_VALIDATION_RETRIES: '-1' })).toThrow('MOTIFY_AGENT_MAX_VALIDATION_RETRIES');
    expect(() => parseEnvironment({ ...valid, MOTIFY_AGENT_MAX_VALIDATION_RETRIES: '11' })).toThrow('MOTIFY_AGENT_MAX_VALIDATION_RETRIES');
  });

  it('defaults credit packs to the published credit pricing', () => {
    expect(parseEnvironment(valid).creditPacks.map((pack) => [pack.id, pack.priceCents, pack.credits])).toEqual([
      ['credits-30', 250, 30], ['credits-65', 500, 65], ['credits-135', 1_000, 135],
      ['credits-350', 2_500, 350], ['credits-720', 5_000, 720], ['credits-1450', 10_000, 1_450],
    ]);
  });

  it('reads credit packs from CREDIT_PACKS and allows none', () => {
    expect(parseEnvironment({ ...valid, CREDIT_PACKS: ' 1.99:20 , 9:100 ' }).creditPacks).toEqual([
      { id: 'credits-20', priceCents: 199, currency: 'USD', credits: 20 },
      { id: 'credits-100', priceCents: 900, currency: 'USD', credits: 100 },
    ]);
    expect(parseEnvironment({ ...valid, CREDIT_PACKS: '' }).creditPacks).toEqual([]);
  });

  it('rejects credit packs a KHQR cannot carry', () => {
    expect(() => parseEnvironment({ ...valid, CREDIT_PACKS: '5' })).toThrow('CREDIT_PACKS');
    expect(() => parseEnvironment({ ...valid, CREDIT_PACKS: '0:30' })).toThrow('CREDIT_PACKS');
    expect(() => parseEnvironment({ ...valid, CREDIT_PACKS: '2.555:30' })).toThrow('CREDIT_PACKS');
    expect(() => parseEnvironment({ ...valid, CREDIT_PACKS: '5:1.5' })).toThrow('CREDIT_PACKS');
    expect(() => parseEnvironment({ ...valid, CREDIT_PACKS: '5:65,6:65' })).toThrow('same credit amount');
  });

  it('runs Bakong in sandbox without a token, but never in production', () => {
    const development = { ...valid, NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'false' };
    expect(parseEnvironment({ ...development, BAKONG_MODE: 'sandbox' }).bakong).toMatchObject({
      mode: 'sandbox', token: null, accountId: 'motify.sandbox@devb',
    });
    expect(parseEnvironment({ ...development, BAKONG_TOKEN: 'token', BAKONG_ACCOUNT_ID: 'motify@aclb' }).bakong).toMatchObject({ mode: 'live' });
    expect(() => parseEnvironment({ ...valid, BAKONG_MODE: 'sandbox' })).toThrow('BAKONG_MODE=sandbox is refused');
    expect(() => parseEnvironment({ ...development, BAKONG_MODE: 'test' })).toThrow();
  });
});
