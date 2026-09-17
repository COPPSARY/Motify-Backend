import { describe, expect, it, vi } from 'vitest';

import { Hashn0deMotionModelProvider } from '../../../../packages/ai/providers/hashn0de.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

describe('Hashn0deMotionModelProvider', () => {
    it('uses OpenAI chat-completions structured output and validates the composition', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(generation) } }],
            usage: { prompt_tokens: 1_200, completion_tokens: 340 },
        });
        const provider = new Hashn0deMotionModelProvider({ apiKey: 'test-key', client: { chat: { completions: { create } } } });

        await expect(provider.generate({
            model: 'claude-sonnet-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            model: 'claude-sonnet-5',
            max_completion_tokens: 2_000,
            messages: [
                { role: 'system', content: 'Motify rules' },
                { role: 'user', content: 'Create it' },
            ],
            response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'motify_generation' }) },
        }));
    });

    it('returns the OpenAI chat-completion text', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Start with the logo. Then reveal the title.' } }] });
        const provider = new Hashn0deMotionModelProvider({ apiKey: 'test-key', client: { chat: { completions: { create } } } });

        await expect(provider.chat({
            model: 'claude-sonnet-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with the logo. Then reveal the title.');
    });

    it('uses JSON Schema for structured intent output', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"intent":"EDIT"}' } }] });
        const provider = new Hashn0deMotionModelProvider({ apiKey: 'test-key', client: { chat: { completions: { create } } } });
        await expect(provider.structured({ model: 'claude-sonnet-5', systemInstructions: 'Classify.', prompt: 'Change it', schemaName: 'motify_intent', schema: intentSchema, limits: { maxOutputTokens: 128 } })).resolves.toEqual({ intent: 'EDIT' });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'motify_intent' }) } }));
    });

    it('requires an API key', () => {
        expect(() => new Hashn0deMotionModelProvider({ apiKey: '  ' }))
            .toThrowError(/hashn0de API key/);
    });
});
