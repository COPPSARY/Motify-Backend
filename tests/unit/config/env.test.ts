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
});
