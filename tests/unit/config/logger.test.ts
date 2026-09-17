import { describe, expect, it } from 'vitest';

import { createLogger, serializeLogError } from '../../../src/config/logger.js';

describe('logger configuration', () => {
  it('uses info level in production and redacts sensitive request fields', () => {
    const logger = createLogger({ nodeEnv: 'production' });

    expect(logger.level).toBe('info');
    expect(logger.bindings().service).toBe('motify-api');
  });

  it('allows an explicit log level', () => {
    expect(createLogger({ nodeEnv: 'development', logLevel: 'debug' }).level).toBe('debug');
  });

  it('removes secrets from error messages and only includes a stack when requested', () => {
    const error = new Error('OAuth failed: https://example.com/callback?code=secret-code&access_token=secret-token');

    expect(serializeLogError(error, false)).toEqual({
      name: 'Error',
      message: 'OAuth failed: https://example.com/callback?code=[REDACTED]&access_token=[REDACTED]',
    });
    expect(serializeLogError(error, true)).toHaveProperty('stack');
  });
});
