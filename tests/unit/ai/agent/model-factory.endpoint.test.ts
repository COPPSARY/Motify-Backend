import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentModel } from '../../../../packages/ai/agent/model-factory.js';

async function pathCalledFor(aiProvider: 'openai-compatible' | 'openrouter', aiModel: string): Promise<string> {
    let called = '';
    vi.stubGlobal('fetch', async (url: string) => {
        called = new URL(String(url)).pathname;
        return new Response('{"error":{"message":"stub"}}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
    const model = createAgentModel({
        aiProvider,
        aiModel,
        openAiCompatibleApiKey: 'key',
        openAiCompatibleBaseUrl: 'https://proxy.test/v1',
        openRouterApiKey: 'key',
        openRouterBaseUrl: 'https://router.test/api/v1',
    });
    await model.invoke('hi').catch(() => undefined);
    return called;
}

describe('createAgentModel endpoint', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses Chat Completions for gpt-5 names on an OpenAI-compatible endpoint, which proxies serve and the Responses API they often do not', async () => {
        expect(await pathCalledFor('openai-compatible', 'gpt-5.6-terra')).toBe('/v1/chat/completions');
        expect(await pathCalledFor('openai-compatible', 'gpt-5.6-sol')).toBe('/v1/chat/completions');
    });

    it('keeps using Chat Completions for other model names', async () => {
        expect(await pathCalledFor('openai-compatible', 'claude-sonnet-5')).toBe('/v1/chat/completions');
    });

    it('uses Chat Completions through OpenRouter as well', async () => {
        expect(await pathCalledFor('openrouter', 'openai/gpt-5.6-terra')).toBe('/api/v1/chat/completions');
    });
});
