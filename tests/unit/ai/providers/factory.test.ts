import { describe, expect, it } from 'vitest';

import { createModelProvider } from '../../../../packages/ai/providers/factory.js';

describe('createModelProvider', () => {
    it('builds the Gemini provider from the Gemini key', () => {
        const provider = createModelProvider({ aiProvider: 'gemini', geminiApiKey: 'gemini-key' });

        expect(provider.name).toBe('gemini');
    });

    it('builds the Anthropic provider from the Anthropic key', () => {
        const provider = createModelProvider({ aiProvider: 'anthropic', anthropicApiKey: 'anthropic-key' });

        expect(provider.name).toBe('anthropic');
    });

    it('builds the OpenAI-compatible provider from its key and base URL', () => {
        const provider = createModelProvider({
            aiProvider: 'openai-compatible',
            openAiCompatibleApiKey: 'openai-compatible-key',
            openAiCompatibleBaseUrl: 'https://api.openai.com/v1',
        });

        expect(provider.name).toBe('openai-compatible');
    });

    it('names the missing variable when the selected provider has no key', () => {
        expect(() => createModelProvider({ aiProvider: 'anthropic', geminiApiKey: 'gemini-key' }))
            .toThrowError(/ANTHROPIC_API_KEY/);
    });

    it('rejects a key that is only whitespace', () => {
        expect(() => createModelProvider({ aiProvider: 'gemini', geminiApiKey: '   ' }))
            .toThrowError(/GEMINI_API_KEY/);
    });

    it('names the OpenAI-compatible variable when its selected key is missing', () => {
        expect(() => createModelProvider({
            aiProvider: 'openai-compatible',
            openAiCompatibleBaseUrl: 'https://api.openai.com/v1',
        })).toThrowError(/OPENAI_COMPATIBLE_API_KEY/);
    });

    it('requires a base URL for the OpenAI-compatible provider', () => {
        expect(() => createModelProvider({
            aiProvider: 'openai-compatible',
            openAiCompatibleApiKey: 'openai-compatible-key',
        })).toThrowError(/OPENAI_COMPATIBLE_BASE_URL/);
    });
});
