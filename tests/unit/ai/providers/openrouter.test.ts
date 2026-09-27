import { describe, expect, it, vi } from 'vitest';

import { OpenRouterMotionModelProvider } from '../../../../packages/ai/providers/openrouter.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

function chatResult(content: unknown, usage?: { promptTokens: number; completionTokens: number }) {
    return {
        id: 'gen_test', object: 'chat.completion', created: 0, model: 'openrouter/test',
        systemFingerprint: null,
        choices: [{ index: 0, finishReason: 'stop', message: { role: 'assistant', content } }],
        ...(usage ? { usage } : {}),
    };
}

function providerWith(send: ReturnType<typeof vi.fn>) {
    return new OpenRouterMotionModelProvider({ apiKey: 'test-key', client: { chat: { send } } as never });
}

describe('OpenRouterMotionModelProvider', () => {
    it('uses OpenRouter chat completions with structured output and validates the composition', async () => {
        const send = vi.fn().mockResolvedValue(chatResult(JSON.stringify(generation), { promptTokens: 1_200, completionTokens: 340 }));
        const provider = providerWith(send);

        await expect(provider.generate({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            chatRequest: expect.objectContaining({
                model: 'anthropic/claude-opus-5',
                maxCompletionTokens: 2_000,
                messages: [
                    { role: 'system', content: expect.stringContaining('Motify rules') },
                    { role: 'user', content: 'Create it' },
                ],
                responseFormat: { type: 'json_schema', jsonSchema: expect.objectContaining({ name: 'motify_generation' }) },
            }),
        }));
    });

    it('states the schema in the prompt as well as declaring it', async () => {
        // responseFormat is the real enforcement, but a provider OpenRouter
        // routes to can accept it and drop it; restating the schema in-prompt
        // means the model still sees the field names.
        const send = vi.fn().mockResolvedValue(chatResult(JSON.stringify(generation)));
        const provider = providerWith(send);

        await provider.generate({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        });

        const systemContent = send.mock.calls[0]?.[0].chatRequest.messages[0].content;
        expect(systemContent).toContain('compositionHtml');
        expect(systemContent).toContain('OUTPUT FORMAT');
    });

    it('returns the chat-completion text for chat', async () => {
        const send = vi.fn().mockResolvedValue(chatResult('Start with a title reveal.'));
        const provider = providerWith(send);

        await expect(provider.chat({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with a title reveal.');
    });

    it('sends generation images as OpenRouter image_url content parts', async () => {
        const send = vi.fn().mockResolvedValue(chatResult(JSON.stringify(generation)));
        const provider = providerWith(send);
        await provider.generate({ model: 'anthropic/claude-opus-5', systemInstructions: 'Rules', prompt: 'Use it', limits: { maxOutputTokens: 2_000 }, images: [
            { assetId: 'a', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=', role: 'asset' },
        ] });
        expect(send.mock.calls[0]?.[0].chatRequest.messages[1]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'Use it' },
                { type: 'image_url', imageUrl: { url: 'data:image/png;base64,aGVsbG8=' } },
            ],
        });
    });

    it('uses JSON Schema for structured intent output', async () => {
        const send = vi.fn().mockResolvedValue(chatResult('{"intent":"CHAT"}'));
        const provider = providerWith(send);
        await expect(provider.structured({ model: 'anthropic/claude-opus-5', systemInstructions: 'Classify.', prompt: 'Hello', schemaName: 'motify_intent', schema: intentSchema, limits: { maxOutputTokens: 128 } })).resolves.toEqual({ intent: 'CHAT' });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            chatRequest: expect.objectContaining({ responseFormat: { type: 'json_schema', jsonSchema: expect.objectContaining({ name: 'motify_intent' }) } }),
        }));
    });

    it('rejects a streaming response as a safety net', async () => {
        const send = vi.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({}) });
        const provider = providerWith(send);

        await expect(provider.chat({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Hi' }], limits: { maxOutputTokens: 500 },
        })).rejects.toEqual(expect.objectContaining({ code: 'PROVIDER_ERROR' }));
    });

    it('joins text parts when the model returns content as an array instead of a plain string', async () => {
        // Some models routed through OpenRouter return assistant content as
        // `[{ type: 'text', text }]` (the SDK's documented array form) even for
        // a plain reply, not only for multimodal output.
        const send = vi.fn().mockResolvedValue(chatResult([
            { type: 'text', text: 'Start with a ' },
            { type: 'text', text: 'title reveal.' },
        ]));
        const provider = providerWith(send);

        await expect(provider.chat({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }], limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with a title reveal.');
    });

    it('reports the raw content shape when the response is genuinely empty', async () => {
        const send = vi.fn().mockResolvedValue(chatResult(null));
        const provider = providerWith(send);

        await expect(provider.chat({
            model: 'anthropic/claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Hi' }], limits: { maxOutputTokens: 500 },
        })).rejects.toEqual(expect.objectContaining({
            code: 'PROVIDER_OUTPUT_INVALID',
            diagnostics: expect.objectContaining({ cause: expect.stringContaining('null') }),
        }));
    });

    it('disables reasoning by default so a default-adaptive-thinking model cannot spend the whole token budget on hidden reasoning', async () => {
        const send = vi.fn().mockResolvedValue(chatResult('CHAT'));
        const provider = providerWith(send);

        await provider.chat({
            model: 'anthropic/claude-sonnet-5', systemInstructions: 'Classify.',
            messages: [{ role: 'user', content: 'Hi' }], limits: { maxOutputTokens: 128 },
        });

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            chatRequest: expect.objectContaining({ reasoning: { effort: 'none' } }),
        }));
    });

    it('requests low reasoning effort when the caller opts into thinking', async () => {
        const send = vi.fn().mockResolvedValue(chatResult(JSON.stringify(generation)));
        const provider = providerWith(send);

        await provider.generate({
            model: 'anthropic/claude-sonnet-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 32_000, thinking: 'auto' },
        });

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            chatRequest: expect.objectContaining({ reasoning: { effort: 'low' } }),
        }));
    });

    it('requires providers that support the requested response schema', async () => {
        const send = vi.fn().mockResolvedValue(chatResult(JSON.stringify(generation)));
        const provider = providerWith(send);

        await provider.generate({
            model: 'anthropic/claude-sonnet-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        });

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            chatRequest: expect.objectContaining({ provider: { requireParameters: true } }),
        }));
    });

    it('reads the schema response from a tool call when a provider emulates responseFormat that way', async () => {
        // Some providers routed through OpenRouter implement responseFormat by
        // forcing a tool call instead of complying in the message body, leaving
        // `content` null with the JSON sitting in the tool call's arguments.
        const send = vi.fn().mockResolvedValue({
            id: 'gen_test', object: 'chat.completion', created: 0, model: 'openrouter/test', systemFingerprint: null,
            choices: [{
                index: 0,
                finishReason: 'tool_calls',
                message: {
                    role: 'assistant',
                    content: null,
                    toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'motify_generation', arguments: JSON.stringify(generation) } }],
                },
            }],
        });
        const provider = providerWith(send);

        await expect(provider.generate({
            model: 'anthropic/claude-sonnet-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: null, outputTokens: null } });
    });

    it('reports finish reason and reasoning length when the response is genuinely empty', async () => {
        const send = vi.fn().mockResolvedValue({
            id: 'gen_test', object: 'chat.completion', created: 0, model: 'openrouter/test', systemFingerprint: null,
            choices: [{
                index: 0,
                finishReason: 'length',
                message: { role: 'assistant', content: null, reasoning: 'thinking'.repeat(1000) },
            }],
        });
        const provider = providerWith(send);

        await expect(provider.generate({
            model: 'anthropic/claude-sonnet-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000, thinking: 'auto' },
        })).rejects.toEqual(expect.objectContaining({
            code: 'PROVIDER_OUTPUT_INVALID',
            diagnostics: expect.objectContaining({
                cause: expect.stringMatching(/finishReason: length.*reasoning: \d+ chars.*toolCalls: 0/),
            }),
        }));
    });

    it('requires an API key', () => {
        expect(() => new OpenRouterMotionModelProvider({ apiKey: '  ' }))
            .toThrowError(/API key/);
    });
});
