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

  it('rejects the removed OpenAI-compatible provider', () => {
    expect(() => parseEnvironment({ ...valid, AI_PROVIDER: 'openai-compatible' })).toThrow();
  });

  it('parses the SP Cambodia provider and API key', () => {
    const environment = parseEnvironment({
      ...valid,
      AI_PROVIDER: 'sp-cambodia',
      SP_CAMBO_API_KEY: 'sp-cambodia-key',
    });

    expect(environment.aiProvider).toBe('sp-cambodia');
    expect(environment.spCambodiaApiKey).toBe('sp-cambodia-key');
  });

  it('parses the ClaudeRouter provider and API key', () => {
    const environment = parseEnvironment({
      ...valid,
      AI_PROVIDER: 'clauderouter',
      CLAUDEROUTER_API_KEY: 'clauderouter-key',
    });

    expect(environment.aiProvider).toBe('clauderouter');
    expect(environment.claudeRouterApiKey).toBe('clauderouter-key');
  });

  it('parses the hashn0de provider and API key', () => {
    const environment = parseEnvironment({
      ...valid,
      AI_PROVIDER: 'hashn0de',
      HASHN0DE_API_KEY: 'hashn0de-key',
    });

    expect(environment.aiProvider).toBe('hashn0de');
    expect(environment.hashn0deApiKey).toBe('hashn0de-key');
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
});
