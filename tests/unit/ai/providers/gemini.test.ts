import { describe, expect, it, vi } from 'vitest';

import { GeminiMotionModelProvider } from '../../../../packages/ai/providers/gemini.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

describe('GeminiMotionModelProvider', () => {
    it('requests structured JSON and validates the generated composition', async () => {
        const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(generation), usageMetadata: { promptTokenCount: 1_200, candidatesTokenCount: 340 } });
        const provider = new GeminiMotionModelProvider({ apiKey: 'test-key', client: { models: { generateContent } } });

        await expect(provider.generate({
            model: 'gemini-test', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-test', contents: 'Create it',
            config: expect.objectContaining({
                systemInstruction: 'Motify rules', responseMimeType: 'application/json',
                responseJsonSchema: expect.objectContaining({ type: 'object' }),
            }),
        }));
        expect(generateContent.mock.calls[0]?.[0].config).not.toHaveProperty('abortSignal');
        expect(generateContent.mock.calls[0]?.[0].config).not.toHaveProperty('httpOptions.timeout');
    });

    it('returns text for chat without forcing the generation schema', async () => {
        const generateContent = vi.fn().mockResolvedValue({ text: 'What should move first?' });
        const provider = new GeminiMotionModelProvider({ apiKey: 'test-key', client: { models: { generateContent } } });

        await expect(provider.chat({
            model: 'gemini-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Help me plan' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('What should move first?');
        expect(generateContent.mock.calls[0]?.[0].config).not.toHaveProperty('responseJsonSchema');
    });

    it('requests schema-constrained intent output', async () => {
        const generateContent = vi.fn().mockResolvedValue({ text: '{"intent":"PLAN"}' });
        const provider = new GeminiMotionModelProvider({ apiKey: 'test-key', client: { models: { generateContent } } });

        await expect(provider.structured({
            model: 'gemini-test', systemInstructions: 'Classify requests.', prompt: 'Plan it.',
            schemaName: 'motify_intent', schema: intentSchema,
            limits: { maxOutputTokens: 128 },
        })).resolves.toEqual({ intent: 'PLAN' });
        expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
            config: expect.objectContaining({ responseMimeType: 'application/json', responseJsonSchema: expect.objectContaining({ type: 'object' }) }),
        }));
    });

    it('normalizes rate limits without exposing the provider response body', async () => {
        const generateContent = vi.fn().mockRejectedValue({ status: 429, message: 'secret provider body' });
        const provider = new GeminiMotionModelProvider({ apiKey: 'test-key', client: { models: { generateContent } } });

        const result = provider.chat({
            model: 'gemini-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Help me plan' }], limits: { maxOutputTokens: 500 },
        });

        await expect(result).rejects.toEqual(expect.objectContaining({
            code: 'PROVIDER_RATE_LIMITED', retryable: true,
        }));
        await expect(result).rejects.not.toThrow('secret provider body');
    });
});
