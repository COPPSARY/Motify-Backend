import { describe, expect, it, vi } from 'vitest';

import { ClaudeRouterMotionModelProvider } from '../../../../packages/ai/providers/clauderouter.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

function completion(content: string) {
    return { choices: [{ message: { content } }], usage: { prompt_tokens: 1_200, completion_tokens: 340 } };
}

describe('ClaudeRouterMotionModelProvider', () => {
    it('uses the OpenAI chat-completions structured-output format', async () => {
        const create = vi.fn().mockResolvedValue(completion(JSON.stringify(generation)));
        const provider = new ClaudeRouterMotionModelProvider({
            apiKey: 'test-key',
            client: { chat: { completions: { create } } },
        });

        await expect(provider.generate({
            model: 'claude-opus-5',
            systemInstructions: 'Motionly rules',
            prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            model: 'claude-opus-5',
            messages: [
                { role: 'system', content: 'Motionly rules' },
                { role: 'user', content: 'Create it' },
            ],
            response_format: {
                type: 'json_schema',
                json_schema: expect.objectContaining({ name: 'motionly_generation', strict: true }),
            },
        }));
    });

    it('sends system instructions ahead of the chat history', async () => {
        const create = vi.fn().mockResolvedValue(completion('Start with a title reveal.'));
        const provider = new ClaudeRouterMotionModelProvider({
            apiKey: 'test-key',
            client: { chat: { completions: { create } } },
        });

        await expect(provider.chat({
            model: 'claude-opus-5',
            systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }],
            limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with a title reveal.');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            messages: [
                { role: 'system', content: 'Plan motion' },
                { role: 'user', content: 'How should it start?' },
            ],
        }));
    });

    it('uses JSON Schema for structured output', async () => {
        const create = vi.fn().mockResolvedValue(completion('{"intent":"CHAT"}'));
        const provider = new ClaudeRouterMotionModelProvider({
            apiKey: 'test-key',
            client: { chat: { completions: { create } } },
        });

        await expect(provider.structured({
            model: 'claude-opus-5',
            systemInstructions: 'Classify.',
            prompt: 'Hello',
            schemaName: 'motionly_intent',
            schema: intentSchema,
            limits: { maxOutputTokens: 128 },
        })).resolves.toEqual({ intent: 'CHAT' });
    });

    it('rejects an empty completion as unusable output', async () => {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
        const provider = new ClaudeRouterMotionModelProvider({
            apiKey: 'test-key',
            client: { chat: { completions: { create } } },
        });

        await expect(provider.chat({
            model: 'claude-opus-5',
            systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Hello' }],
            limits: { maxOutputTokens: 500 },
        })).rejects.toEqual(expect.objectContaining({ code: 'PROVIDER_OUTPUT_INVALID' }));
    });

    it('requires an API key', () => {
        expect(() => new ClaudeRouterMotionModelProvider({ apiKey: '  ' }))
            .toThrowError(/ClaudeRouter API key/);
    });
});
