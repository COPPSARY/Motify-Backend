import { describe, expect, it, vi } from 'vitest';

import { AnthropicMotionModelProvider } from '../../../../packages/ai/providers/anthropic.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

const providerOptions = {
    apiKey: 'test-key',
};

describe('AnthropicMotionModelProvider', () => {
    it('uses OpenAI chat-completions structured output and validates the composition', async () => {
        const create = vi.fn().mockResolvedValue({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'claude-test',
            choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: JSON.stringify(generation), refusal: null } }],
            usage: { prompt_tokens: 1_200, completion_tokens: 340, total_tokens: 1_540 },
        });
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await expect(provider.generate({
            model: 'claude-test', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(create).toHaveBeenCalledWith({
            model: 'claude-test',
            messages: [
                { role: 'system', content: 'Motify rules' },
                { role: 'user', content: 'Create it' },
            ],
            max_completion_tokens: 2_000,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'motify_generation',
                    strict: true,
                    schema: expect.any(Object),
                },
            },
        });
    });

    it('returns the OpenAI chat-completion text', async () => {
        const create = vi.fn().mockResolvedValue({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'claude-test',
            choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'Start with the logo.', refusal: null } }],
        });
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await expect(provider.chat({
            model: 'claude-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with the logo.');
        expect(create).toHaveBeenCalledWith({
            model: 'claude-test',
            messages: [
                { role: 'system', content: 'Plan motion' },
                { role: 'user', content: 'How should it start?' },
            ],
            max_completion_tokens: 500,
        });
    });

    it('sends generation images as OpenAI-compatible vision content', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(generation) } }],
        });
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });
        await provider.generate({ model: 'claude-test', systemInstructions: 'Rules', prompt: 'Use it', limits: { maxOutputTokens: 2_000 }, images: [
            { assetId: 'a', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=', role: 'asset' },
        ] });
        expect(create.mock.calls[0]?.[0].messages[1]).toEqual({ role: 'user', content: [
            { type: 'text', text: 'Use it' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ] });
    });

    it('uses JSON Schema for structured intent output', async () => {
        const create = vi.fn().mockResolvedValue({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'claude-test',
            choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: '{"intent":"EDIT"}', refusal: null } }],
        });
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await expect(provider.structured({
            model: 'claude-test', systemInstructions: 'Classify.', prompt: 'Change it',
            schemaName: 'motify_intent', schema: intentSchema,
            limits: { maxOutputTokens: 128 },
        })).resolves.toEqual({ intent: 'EDIT' });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'motify_intent',
                    strict: true,
                    schema: expect.any(Object),
                },
            },
        }));
    });

    it('does not create or pass a request timeout signal', async () => {
        const create = vi.fn().mockResolvedValue({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'claude-test',
            choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: JSON.stringify(generation), refusal: null } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await provider.generate({
            model: 'claude-test', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        });

        expect(timeout).not.toHaveBeenCalled();
        expect(create.mock.calls[0]).toHaveLength(1);
        timeout.mockRestore();
    });

    it('still forwards explicit caller cancellation', async () => {
        const create = vi.fn().mockResolvedValue({
            id: 'chatcmpl-test', object: 'chat.completion', created: 1, model: 'claude-test',
            choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'Ready.', refusal: null } }],
        });
        const controller = new AbortController();
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await provider.chat({
            model: 'claude-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Begin' }],
            limits: { maxOutputTokens: 500 }, signal: controller.signal,
        });

        expect(create.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
    });

    it('normalizes provider errors when no caller signal exists', async () => {
        const create = vi.fn().mockRejectedValue(new Error('gateway failed'));
        const provider = new AnthropicMotionModelProvider({ ...providerOptions, client: { chat: { completions: { create } } } });

        await expect(provider.chat({
            model: 'claude-test', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Begin' }],
            limits: { maxOutputTokens: 500 },
        })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
});
