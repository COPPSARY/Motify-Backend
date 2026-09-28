import { describe, expect, it, vi } from 'vitest';

import { AnthropicMotionModelProvider } from '../../../../packages/ai/providers/anthropic.provider.js';
import { GeminiMotionModelProvider } from '../../../../packages/ai/providers/gemini.provider.js';
import type { MotionModelProvider } from '../../../../packages/ai/providers/model.provider.js';
import { OpenAICompatibleMotionModelProvider } from '../../../../packages/ai/providers/openai.provider.js';
import { OpenRouterMotionModelProvider } from '../../../../packages/ai/providers/openrouter.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';
import { UsageMeter, runWithUsageMeter } from '../../../../packages/ai/usage/usage-meter.js';

const generation = {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main>Launch</main>', timelineJs: 'timeline.play();', reply: 'Created it.',
};

const request = { model: 'm', systemInstructions: 's', limits: { maxOutputTokens: 1_000 } };

/** One provider wired to a stub client that answers `text` and reports 1,000 in / 200 out. */
interface Case {
    name: string;
    build(text: string, usage?: boolean): MotionModelProvider;
}

const cases: Case[] = [
    {
        name: 'gemini',
        // Reasoning is billed as output but reported apart from the candidate tokens.
        build: (text, usage = true) => new GeminiMotionModelProvider({
            apiKey: 'k',
            client: { models: { generateContent: vi.fn().mockResolvedValue({
                text,
                ...(usage ? { usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 150, thoughtsTokenCount: 50 } } : {}),
            }) } },
        }),
    },
    {
        name: 'openai-compatible',
        build: (text, usage = true) => new OpenAICompatibleMotionModelProvider({
            apiKey: 'k', baseURL: 'https://gateway.test/v1',
            client: { chat: { completions: { create: vi.fn().mockResolvedValue({
                choices: [{ message: { content: text } }],
                ...(usage ? { usage: { prompt_tokens: 1_000, completion_tokens: 200 } } : {}),
            }) } } },
        }),
    },
    {
        name: 'anthropic',
        // Cached input is billed too, so it is counted.
        build: (text, usage = true) => new AnthropicMotionModelProvider({
            apiKey: 'k',
            client: { messages: { stream: () => ({ finalMessage: async () => ({
                id: 'msg', type: 'message', role: 'assistant', model: 'm',
                content: [{ type: 'text', text, citations: null }],
                stop_reason: 'end_turn', stop_sequence: null,
                ...(usage ? { usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 200 } } : {}),
            }) }) } } as never,
        }),
    },
    {
        name: 'openrouter',
        build: (text, usage = true) => new OpenRouterMotionModelProvider({
            apiKey: 'k',
            client: { chat: { send: vi.fn().mockResolvedValue({
                id: 'g', object: 'chat.completion', created: 0, model: 'm', systemFingerprint: null,
                choices: [{ index: 0, finishReason: 'stop', message: { role: 'assistant', content: text } }],
                ...(usage ? { usage: { promptTokens: 1_000, completionTokens: 200 } } : {}),
            }) } } as never,
        }),
    },
];

async function metered(work: () => Promise<unknown>) {
    const meter = new UsageMeter();
    await runWithUsageMeter(meter, work).catch(() => undefined);
    return meter.snapshot();
}

describe.each(cases)('$name usage reporting', ({ build }) => {
    it('reports a generation', async () => {
        const provider = build(JSON.stringify(generation));
        expect(await metered(() => provider.generate({ ...request, prompt: 'p' })))
            .toEqual({ inputTokens: 1_000, outputTokens: 200, calls: 1, unreportedCalls: 0 });
    });

    it('reports a structured call, which the graph never counted before', async () => {
        const provider = build(JSON.stringify({ intent: 'EDIT' }));
        expect(await metered(() => provider.structured({ ...request, prompt: 'p', schemaName: 'intent', schema: intentSchema })))
            .toEqual({ inputTokens: 1_000, outputTokens: 200, calls: 1, unreportedCalls: 0 });
    });

    it('reports a chat reply, which the graph never counted before', async () => {
        const provider = build('Hello there');
        expect(await metered(() => provider.chat({ ...request, messages: [{ role: 'user', content: 'hi' }] })))
            .toEqual({ inputTokens: 1_000, outputTokens: 200, calls: 1, unreportedCalls: 0 });
    });

    it('still counts a response the validator then rejects: the tokens were spent', async () => {
        const provider = build('this is not json');
        expect(await metered(() => provider.generate({ ...request, prompt: 'p' })))
            .toEqual({ inputTokens: 1_000, outputTokens: 200, calls: 1, unreportedCalls: 0 });
        expect(await metered(() => provider.structured({ ...request, prompt: 'p', schemaName: 'intent', schema: intentSchema })))
            .toMatchObject({ inputTokens: 1_000, outputTokens: 200 });
    });

    it('flags a call whose provider reported no usage instead of counting it as free', async () => {
        const provider = build('Hello there', false);
        expect(await metered(() => provider.chat({ ...request, messages: [{ role: 'user', content: 'hi' }] })))
            .toEqual({ inputTokens: 0, outputTokens: 0, calls: 1, unreportedCalls: 1 });
    });

    it('does nothing outside a metered request', async () => {
        const provider = build('Hello there');
        await expect(provider.chat({ ...request, messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe('Hello there');
    });
});
