import { describe, expect, it } from 'vitest';

import { sanitizeGeminiSchema } from '../../../../packages/ai/agent/gemini-schema.js';

describe('sanitizeGeminiSchema', () => {
    it('drops keywords Gemini rejects', () => {
        expect(sanitizeGeminiSchema({ $schema: 'x', type: 'number', exclusiveMinimum: 0, additionalProperties: false })).toEqual({ type: 'number' });
    });

    it('turns a nullable type array into nullable: true', () => {
        expect(sanitizeGeminiSchema({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true });
    });

    it('collapses a null branch of anyOf', () => {
        expect(sanitizeGeminiSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({ type: 'string', nullable: true });
    });
});
