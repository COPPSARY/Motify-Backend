import { describe, expect, it } from 'vitest';
import { ModelProviderError, normalizeProviderError } from '../../../../packages/ai/agent/errors.js';

describe('normalizeProviderError', () => {
    it('maps a 429 to PROVIDER_RATE_LIMITED', () => {
        const error = normalizeProviderError('anthropic', { status: 429 });
        expect(error).toBeInstanceOf(ModelProviderError);
        expect(error.code).toBe('PROVIDER_RATE_LIMITED');
        expect(error.retryable).toBe(true);
    });

    it('maps a 429 wrapped in a LangChain error to PROVIDER_RATE_LIMITED', () => {
        const wrapped = Object.assign(new Error('429 upstream is rate limiting; try again shortly', { cause: Object.assign(new Error('429'), { status: 429 }) }), { name: 'RateLimitCapacityError' });
        expect(normalizeProviderError('openai-compatible', wrapped).code).toBe('PROVIDER_RATE_LIMITED');
    });

    it('maps a rate-limit error that carries no status to PROVIDER_RATE_LIMITED', () => {
        const wrapped = Object.assign(new Error('429 upstream is rate limiting; try again shortly'), { name: 'RateLimitCapacityError' });
        expect(normalizeProviderError('openai-compatible', wrapped).code).toBe('PROVIDER_RATE_LIMITED');
    });

    it('reads the HTTP status from an SDK-style message when the graph dropped the status property', () => {
        expect(normalizeProviderError('openai-compatible', new Error('429 upstream is rate limiting')).code).toBe('PROVIDER_RATE_LIMITED');
        expect(normalizeProviderError('anthropic', new Error('401 {"error":{"message":"invalid x-api-key"}}')).code).toBe('PROVIDER_AUTH_FAILED');
        expect(normalizeProviderError('openai-compatible', new Error('503 Service Unavailable')).code).toBe('PROVIDER_UNAVAILABLE');
        expect(normalizeProviderError('gemini', new Error('[GoogleGenerativeAI Error]: Error fetching from https://x: [429 Too Many Requests] quota')).code).toBe('PROVIDER_RATE_LIMITED');
    });

    it('does not mistake a number inside an unrelated message for an HTTP status', () => {
        expect(normalizeProviderError('openai-compatible', new Error('Connection error. retried 429 times')).code).toBe('PROVIDER_ERROR');
        expect(normalizeProviderError('openai-compatible', new Error('terminated')).code).toBe('PROVIDER_ERROR');
    });

    it('passes an existing ModelProviderError through, filling in the provider', () => {
        const original = new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'bad output', false);
        const error = normalizeProviderError('openrouter', original);
        expect(error).toBe(original);
        expect(error.provider).toBe('openrouter');
    });
});
