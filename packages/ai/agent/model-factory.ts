import { createGeminiModel } from './gemini-schema.js';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAICompletions } from '@langchain/openai';

import { withContextBudget } from './context-budget.js';

export interface ModelFactoryEnvironment {
    aiProvider: 'gemini' | 'openai-compatible' | 'anthropic' | 'openrouter';
    aiModel: string;
    geminiApiKey?: string | undefined;
    anthropicApiKey?: string | undefined;
    anthropicBaseUrl?: string | undefined;
    openAiCompatibleApiKey?: string | undefined;
    openAiCompatibleBaseUrl?: string | undefined;
    openRouterApiKey?: string | undefined;
    openRouterBaseUrl?: string | undefined;
    openRouterSiteUrl?: string | undefined;
    openRouterAppName?: string | undefined;
    agentContextTokens?: number | undefined;
}

/**
 * Builds the one LangChain chat model `AI_PROVIDER` selects. Deep Agents drives
 * this model directly through its own tool-calling loop, so unlike the old
 * hand-written providers this returns a plain LangChain `BaseChatModel` rather
 * than a `MotionModelProvider`.
 */
export function createAgentModel(environment: ModelFactoryEnvironment): BaseChatModel {
    const model = buildAgentModel(environment);
    return environment.agentContextTokens !== undefined
        ? withContextBudget(model, environment.agentContextTokens)
        : model;
}

/**
 * Third-party OpenAI-compatible endpoints (proxies, routers) serve Chat Completions; many do not
 * serve the Responses API. `ChatOpenAI` picks the Responses API for `gpt-5` model names no matter
 * how it is configured, and that fails there with a 404 that reads as "model unavailable". So the
 * `openai-compatible` and `openrouter` providers use the Chat-Completions-only class.
 */
function buildAgentModel(environment: ModelFactoryEnvironment): BaseChatModel {
    switch (environment.aiProvider) {
        case 'anthropic': {
            const apiKey = requireKey(environment.anthropicApiKey, 'ANTHROPIC_API_KEY');
            return new ChatAnthropic({
                apiKey,
                model: environment.aiModel,
                ...(environment.anthropicBaseUrl !== undefined ? { anthropicApiUrl: environment.anthropicBaseUrl } : {}),
            });
        }
        case 'gemini': {
            const apiKey = requireKey(environment.geminiApiKey, 'GEMINI_API_KEY');
            return createGeminiModel({ apiKey, model: environment.aiModel });
        }
        case 'openai-compatible': {
            const apiKey = requireKey(environment.openAiCompatibleApiKey, 'OPENAI_COMPATIBLE_API_KEY');
            return new ChatOpenAICompletions({
                apiKey,
                model: environment.aiModel,
                ...(environment.openAiCompatibleBaseUrl !== undefined
                    ? { configuration: { baseURL: environment.openAiCompatibleBaseUrl } }
                    : {}),
            });
        }
        case 'openrouter': {
            const apiKey = requireKey(environment.openRouterApiKey, 'OPENROUTER_API_KEY');
            const headers: Record<string, string> = {};
            if (environment.openRouterSiteUrl !== undefined) headers['HTTP-Referer'] = environment.openRouterSiteUrl;
            if (environment.openRouterAppName !== undefined) headers['X-Title'] = environment.openRouterAppName;
            return new ChatOpenAICompletions({
                apiKey,
                model: environment.aiModel,
                configuration: {
                    baseURL: environment.openRouterBaseUrl ?? 'https://openrouter.ai/api/v1',
                    ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
                },
            });
        }
    }
}

function requireKey(value: string | undefined, envVarName: string): string {
    if (!value) throw new Error(`${envVarName} must be set to use this AI_PROVIDER.`);
    return value;
}
