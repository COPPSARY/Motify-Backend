import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAICompletions } from '@langchain/openai';
import { describe, expect, it } from 'vitest';

import { createAgentModel } from '../../../../packages/ai/agent/model-factory.js';

function environment(overrides: Partial<Record<string, string>> = {}) {
    return {
        aiProvider: 'anthropic' as const,
        aiModel: 'claude-sonnet-5',
        geminiApiKey: undefined,
        anthropicApiKey: 'test-anthropic-key',
        anthropicBaseUrl: undefined,
        openAiCompatibleApiKey: undefined,
        openAiCompatibleBaseUrl: undefined,
        openRouterApiKey: undefined,
        openRouterBaseUrl: undefined,
        openRouterSiteUrl: undefined,
        openRouterAppName: undefined,
        ...overrides,
    };
}

describe('createAgentModel', () => {
    it('builds a ChatGoogleGenerativeAI instance for the gemini provider', () => {
        const model = createAgentModel(environment({ aiProvider: 'gemini', geminiApiKey: 'k', anthropicApiKey: undefined }));
        expect(model).toBeInstanceOf(ChatGoogleGenerativeAI);
    });

    it('builds a ChatAnthropic instance for the anthropic provider', () => {
        const model = createAgentModel(environment({ aiProvider: 'anthropic' }));
        expect(model).toBeInstanceOf(ChatAnthropic);
    });


    it('builds a ChatOpenAI instance pointed at the OpenAI-compatible base URL', () => {
        const model = createAgentModel(environment({
            aiProvider: 'openai-compatible',
            anthropicApiKey: undefined,
            openAiCompatibleApiKey: 'k',
            openAiCompatibleBaseUrl: 'https://example.test/v1',
        }));
        expect(model).toBeInstanceOf(ChatOpenAICompletions);
    });

    it('builds a Chat Completions model pointed at OpenRouter, with attribution headers', () => {
        const model = createAgentModel(environment({
            aiProvider: 'openrouter',
            anthropicApiKey: undefined,
            openRouterApiKey: 'k',
            openRouterSiteUrl: 'https://motify.app',
            openRouterAppName: 'Motify',
        })) as ChatOpenAICompletions;
        expect(model).toBeInstanceOf(ChatOpenAICompletions);
    });

    it('throws a clear error when the required API key for the selected provider is missing', () => {
        expect(() => createAgentModel(environment({ aiProvider: 'anthropic', anthropicApiKey: undefined })))
            .toThrow(/ANTHROPIC_API_KEY/);
    });
});

describe('createAgentModel context budget', () => {
    it('applies the configured context budget to the model profile', () => {
        const model = createAgentModel({ ...environment({ aiProvider: 'anthropic' }), agentContextTokens: 42_000 });
        expect((model.profile as { maxInputTokens?: number }).maxInputTokens).toBe(42_000);
    });

    it('leaves the model profile alone when no budget is configured', () => {
        const model = createAgentModel(environment({ aiProvider: 'anthropic' }));
        expect((model.profile as { maxInputTokens?: number }).maxInputTokens).not.toBe(42_000);
    });
});
