import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleMotionModelProvider } from '../../../../packages/ai/providers/openai.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

const baseURL = 'https://api.openai.com/v1';

describe('OpenAICompatibleMotionModelProvider', () => {
    it('uses OpenAI chat-completions structured output and validates the composition', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(generation) } }],
            usage: { prompt_tokens: 1_200, completion_tokens: 340 },
        });
        const provider = new OpenAICompatibleMotionModelProvider({ apiKey: 'test-key', baseURL, client: { chat: { completions: { create } } } });

        await expect(provider.generate({
            model: 'gpt-test', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-test',
            max_completion_tokens: 2_000,
            messages: [
                { role: 'system', content: 'Motify rules' },
                { role: 'user', content: 'Create it' },
            ],
            response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'motify_generation' }) },
        }));
    });

    it('returns the OpenAI chat-completion text for chat', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Start with a title reveal.' } }] });
        const provider = new OpenAICompatibleMotionModelProvider({ apiKey: 'test-key', baseURL, client: { chat: { completions: { create } } } });

        await expect(provider.chat({
            model: 'gpt-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with a title reveal.');
    });

    it('sends generation images as chat-completion image_url content parts', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(generation) } }] });
        const provider = new OpenAICompatibleMotionModelProvider({ apiKey: 'test-key', baseURL, client: { chat: { completions: { create } } } });
        await provider.generate({ model: 'gpt-test', systemInstructions: 'Rules', prompt: 'Use it', limits: { maxOutputTokens: 2_000 }, images: [
            { assetId: 'a', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=', role: 'asset' },
        ] });
        expect(create.mock.calls[0]?.[0].messages[1]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'Use it' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
            ],
        });
    });

    it('uses JSON Schema for structured intent output', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"intent":"CHAT"}' } }] });
        const provider = new OpenAICompatibleMotionModelProvider({ apiKey: 'test-key', baseURL, client: { chat: { completions: { create } } } });
        await expect(provider.structured({ model: 'gpt-test', systemInstructions: 'Classify.', prompt: 'Hello', schemaName: 'motify_intent', schema: intentSchema, limits: { maxOutputTokens: 128 } })).resolves.toEqual({ intent: 'CHAT' });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'motify_intent' }) } }));
    });

    it('requires an API key', () => {
        expect(() => new OpenAICompatibleMotionModelProvider({ apiKey: '  ', baseURL }))
            .toThrowError(/API key/);
    });

    it('requires a base URL', () => {
        expect(() => new OpenAICompatibleMotionModelProvider({ apiKey: 'test-key', baseURL: '  ' }))
            .toThrowError(/base URL/);
    });
});
