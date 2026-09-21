import { describe, expect, it, vi } from 'vitest';

import { AnthropicMotionModelProvider } from '../../../../packages/ai/providers/anthropic.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

// No real waiting between retries in tests.
const providerOptions = { apiKey: 'test-key', retryDelaysMs: [0, 0] };

/** What the SDK throws for an error event inside an established stream: no HTTP status. */
function overloaded(): Error {
    return Object.assign(new Error('{"type":"error","error":{"type":"overloaded_error"}}'), {
        error: { type: 'error', error: { type: 'overloaded_error', message: 'Upstream service is temporarily unavailable or overloaded.' } },
    });
}

/** A Messages API response: a list of content blocks, plus usage. */
function reply(text: string, usage?: { input_tokens: number; output_tokens: number }) {
    return {
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [{ type: 'text', text, citations: null }],
        stop_reason: 'end_turn', stop_sequence: null,
        ...(usage ? { usage } : {}),
    };
}

/**
 * `generate` streams because a film is the long request; `structured` and
 * `chat` do not. One fake serves both: `stream()` hands back the same message
 * through `finalMessage()`.
 */
function providerWith(create: ReturnType<typeof vi.fn>) {
    const call = create as unknown as (...args: unknown[]) => Promise<unknown>;
    const stream = vi.fn((...args: unknown[]) => ({
        finalMessage: async () => call(...args),
    }));
    return {
        provider: new AnthropicMotionModelProvider({
            ...providerOptions,
            client: { messages: { create, stream } } as never,
        }),
        stream,
    };
}

/** The call the provider actually made, whichever transport it used. */
function sent(create: ReturnType<typeof vi.fn>) {
    return create.mock.calls[0];
}

describe('AnthropicMotionModelProvider', () => {
    it('asks the Messages API for schema-valid JSON and validates the composition', async () => {
        const create = vi.fn().mockResolvedValue(
            reply(JSON.stringify(generation), { input_tokens: 1_200, output_tokens: 340 }),
        );

        // Generation is the call that is worth reasoning over, as GENERATION_LIMITS has it.
        await expect(providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000, thinking: 'auto' },
        })).resolves.toEqual({ generation, usage: { inputTokens: 1_200, outputTokens: 340 } });

        // System instructions are their own field on this API, not a message.
        expect(sent(create)?.[0]).toEqual({
            model: 'claude-opus-5',
            max_tokens: 2_000,
            system: expect.stringContaining('Motify rules'),
            messages: [{ role: 'user', content: 'Create it' }],
            output_config: {
                effort: 'high',
                format: { type: 'json_schema', schema: expect.any(Object) },
            },
            thinking: { type: 'adaptive' },
        });
    });

    it('states the schema in the prompt as well as declaring it', async () => {
        const create = vi.fn().mockResolvedValue(reply(JSON.stringify(generation)));

        await providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        });

        // A relaying gateway can accept output_config.format and drop it. The
        // model then never sees the schema and invents its own field names,
        // which surfaces as a schema mismatch with no clue as to the cause.
        expect(sent(create)?.[0].system).toContain('compositionHtml');
        expect(sent(create)?.[0].system).toContain('OUTPUT FORMAT');
    });

    it('streams the long request, because the SDK refuses not to', async () => {
        const create = vi.fn().mockResolvedValue(reply(JSON.stringify(generation)));
        const { provider, stream } = providerWith(create);

        // Generation and repair both allow 32,000 output tokens, and a
        // non-streaming call that large is rejected by the SDK before it is
        // ever sent.
        await provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Create it',
            limits: { maxOutputTokens: 32_000, thinking: 'auto' },
        });

        expect(stream).toHaveBeenCalledTimes(1);
    });

    it('takes the JSON out of a fenced reply rather than failing the film', async () => {
        const create = vi.fn().mockResolvedValue(
            reply(['```json', JSON.stringify(generation), '```'].join('\n')),
        );

        await expect(providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toMatchObject({ generation });
    });

    it('reads past a gateway that opens its reply with an invisible block', async () => {
        // Seen live: a first text block holding only U+2060, then the film.
        // JSON allows four whitespace characters and this is not one of them,
        // so a complete, valid composition failed on its first character.
        const create = vi.fn().mockResolvedValue({
            ...reply(JSON.stringify(generation)),
            content: [
                { type: 'text', text: '\u2060', citations: null },
                { type: 'text', text: JSON.stringify(generation), citations: null },
            ],
        });

        await expect(providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000, thinking: 'auto' },
        })).resolves.toMatchObject({ generation });
    });

    it('returns the reply text', async () => {
        const create = vi.fn().mockResolvedValue(reply('Start with the logo.'));

        await expect(providerWith(create).provider.chat({
            model: 'claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }],
            limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Start with the logo.');
        expect(sent(create)?.[0]).toMatchObject({
            system: 'Plan motion',
            messages: [{ role: 'user', content: 'How should it start?' }],
            max_tokens: 500,
        });
    });

    it('keeps the answer and leaves the reasoning out of it', async () => {
        // With thinking on, the first block is usually not the answer, and
        // handing a thinking block to JSON.parse is how a sound film would
        // come back as malformed output.
        const create = vi.fn().mockResolvedValue({
            ...reply(JSON.stringify(generation)),
            content: [
                { type: 'thinking', thinking: 'The user wants a launch film...', signature: 'sig' },
                { type: 'text', text: JSON.stringify(generation), citations: null },
            ],
        });

        await expect(providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toMatchObject({ generation });
    });

    it('sends images as Messages API image blocks on the user turn', async () => {
        const create = vi.fn().mockResolvedValue(reply(JSON.stringify(generation)));

        await providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Use it',
            limits: { maxOutputTokens: 2_000 },
            images: [
                { assetId: 'a', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=', role: 'asset' },
                { assetId: 'frame-0', fileName: 'frame-2.40s', mediaType: 'image/jpeg', dataBase64: 'ZnJhbWU=', role: 'frame', capturedAtSeconds: 2.4 },
            ],
        });

        // Base64 source blocks, not OpenAI data: URLs - and a rendered frame
        // rides exactly like any other image, since only the prompt separates them.
        expect(sent(create)?.[0].messages[0]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'Use it' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ZnJhbWU=' } },
            ],
        });
    });

    it('attaches chat images to the newest user turn only', async () => {
        const create = vi.fn().mockResolvedValue(reply('Noted.'));

        await providerWith(create).provider.chat({
            model: 'claude-opus-5', systemInstructions: 'Plan motion',
            messages: [
                { role: 'user', content: 'First' },
                { role: 'assistant', content: 'Go on' },
                { role: 'user', content: 'Second' },
            ],
            limits: { maxOutputTokens: 500 },
            images: [{ assetId: 'a', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=', role: 'reference' }],
        });

        const messages = sent(create)?.[0].messages;
        expect(messages[0]).toEqual({ role: 'user', content: 'First' });
        expect(messages[2].content).toHaveLength(2);
    });

    it('uses a JSON schema for structured intent output', async () => {
        const create = vi.fn().mockResolvedValue(reply('{"intent":"EDIT"}'));

        await expect(providerWith(create).provider.structured({
            model: 'claude-opus-5', systemInstructions: 'Classify.', prompt: 'Change it',
            schemaName: 'motify_intent', schema: intentSchema,
            limits: { maxOutputTokens: 128 },
        })).resolves.toEqual({ intent: 'EDIT' });
        expect(sent(create)?.[0].output_config.format).toEqual({
            type: 'json_schema',
            schema: expect.any(Object),
        });
    });

    it('spends low effort and no thinking on a call that is not worth reasoning', async () => {
        const create = vi.fn().mockResolvedValue(reply('{"intent":"CHAT"}'));

        await providerWith(create).provider.structured({
            model: 'claude-opus-5', systemInstructions: 'Classify.', prompt: 'Hello',
            schemaName: 'motify_intent', schema: intentSchema,
            limits: { maxOutputTokens: 128, thinking: 'none' },
        });

        // Routing is not the reasoning, and on Opus thinking is on unless the
        // request says otherwise. Omitting it spent all 128 tokens reasoning
        // and returned an empty answer.
        expect(sent(create)?.[0].output_config.effort).toBe('low');
        expect(sent(create)?.[0].thinking).toEqual({ type: 'disabled' });
    });

    it('treats an unset thinking preference as not worth reasoning over', async () => {
        const create = vi.fn().mockResolvedValue(reply('{"intent":"CHAT"}'));

        await providerWith(create).provider.structured({
            model: 'claude-opus-5', systemInstructions: 'Classify.', prompt: 'Hello',
            schemaName: 'motify_intent', schema: intentSchema,
            limits: { maxOutputTokens: 128 },
        });

        // The contract calls unset "the model's own default - little or none",
        // which is true of the lite tiers and false of Opus.
        expect(sent(create)?.[0].thinking).toEqual({ type: 'disabled' });
    });

    it('does not create or pass a request timeout signal', async () => {
        const create = vi.fn().mockResolvedValue(
            reply(JSON.stringify(generation), { input_tokens: 1, output_tokens: 1 }),
        );
        const timeout = vi.spyOn(AbortSignal, 'timeout');

        await providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Motify rules', prompt: 'Create it',
            limits: { maxOutputTokens: 2_000 },
        });

        expect(timeout).not.toHaveBeenCalled();
        expect(sent(create)?.[1]).toEqual({});
        timeout.mockRestore();
    });

    it('still forwards explicit caller cancellation', async () => {
        const create = vi.fn().mockResolvedValue(reply('Ready.'));
        const controller = new AbortController();

        await providerWith(create).provider.chat({
            model: 'claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Begin' }],
            limits: { maxOutputTokens: 500 }, signal: controller.signal,
        });

        expect(sent(create)?.[1]).toEqual({ signal: controller.signal });
    });

    it('normalizes provider errors when no caller signal exists', async () => {
        const create = vi.fn().mockRejectedValue(new Error('gateway failed'));

        await expect(providerWith(create).provider.chat({
            model: 'claude-opus-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Begin' }],
            limits: { maxOutputTokens: 500 },
        })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('tries again after an overload mid-stream', async () => {
        // Seen live: one overload during skill selection ended the whole turn.
        const create = vi.fn()
            .mockRejectedValueOnce(overloaded())
            .mockResolvedValueOnce(reply('{"intent":"CREATE"}'));

        await expect(providerWith(create).provider.structured({
            model: 'claude-sonnet-5', systemInstructions: 'Classify.', prompt: 'Make an ad',
            schemaName: 'motify_intent', schema: intentSchema, limits: { maxOutputTokens: 128 },
        })).resolves.toEqual({ intent: 'CREATE' });
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('gives up after repeated overloads and says the model is unavailable', async () => {
        const create = vi.fn().mockRejectedValue(overloaded());

        await expect(providerWith(create).provider.chat({
            model: 'claude-sonnet-5', systemInstructions: 'Plan motion',
            messages: [{ role: 'user', content: 'Begin' }], limits: { maxOutputTokens: 500 },
        })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
        // The first attempt and the two retries.
        expect(create).toHaveBeenCalledTimes(3);
    });

    it('does not retry a stream cut off at the gateway time limit', async () => {
        // That failure takes minutes to arrive; retrying would take minutes again.
        const create = vi.fn().mockRejectedValue(new Error('stream ended without producing a Message with role=assistant'));

        await expect(providerWith(create).provider.generate({
            model: 'claude-opus-5', systemInstructions: 'Rules', prompt: 'Create it',
            limits: { maxOutputTokens: 32_000, thinking: 'auto' },
        })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty key rather than failing on the first call', () => {
        expect(() => new AnthropicMotionModelProvider({ apiKey: '  ' })).toThrow(/API key is required/);
    });
});
