import { describe, expect, it, vi } from 'vitest';

import { OpenAIMotionModelProvider } from '../../../../packages/ai/providers/openai.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

describe('OpenAIMotionModelProvider', () => {
    it('uses the Responses API structured-output format', async () => {
        const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(generation), usage: { input_tokens: 1_200, output_tokens: 340 } });
        const provider = new OpenAIMotionModelProvider({ apiKey: 'test-key', client: { responses: { create } } });

        await expect(provider.generate({
            model: 'gpt-test', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-test', instructions: 'Motify rules', input: 'Create it',
            text: { format: expect.objectContaining({ type: 'json_schema', name: 'motify_generation', strict: true }) },
        }));
    });

    it('returns the Responses API output text for chat', async () => {
        const create = vi.fn().mockResolvedValue({ output_text: 'Start with a title reveal.' });
        const provider = new OpenAIMotionModelProvider({ apiKey: 'test-key', client: { responses: { create } } });

        await expect(provider.chat({
            model: 'gpt-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with a title reveal.');
    });

    it('uses JSON Schema for structured intent output', async () => {
        const create = vi.fn().mockResolvedValue({ output_text: '{"intent":"CHAT"}' });
        const provider = new OpenAIMotionModelProvider({ apiKey: 'test-key', client: { responses: { create } } });
        await expect(provider.structured({ model: 'gpt-test', systemInstructions: 'Classify.', prompt: 'Hello', schemaName: 'motify_intent', schema: intentSchema, limits: { maxOutputTokens: 128 } })).resolves.toEqual({ intent: 'CHAT' });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ text: { format: expect.objectContaining({ type: 'json_schema', name: 'motify_intent', strict: true }) } }));
    });
});
