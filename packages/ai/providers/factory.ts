import { AnthropicMotionModelProvider } from './anthropic.provider.js';
import { GeminiMotionModelProvider } from './gemini.provider.js';
import type { ModelProviderName, MotionModelProvider } from './model.provider.js';
import { OpenAICompatibleMotionModelProvider } from './openai.provider.js';

/** The provider-selection slice of the parsed environment. */
export interface ModelProviderConfig {
    aiProvider: ModelProviderName;
    geminiApiKey?: string | undefined;
    anthropicApiKey?: string | undefined;
    /** A Messages API gateway other than Anthropic's own. */
    anthropicBaseUrl?: string | undefined;
    openAiCompatibleApiKey?: string | undefined;
    openAiCompatibleBaseUrl?: string | undefined;
}

const KEY_VARIABLES: Record<ModelProviderName, string> = {
    gemini: 'GEMINI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
};

/**
 * Builds the single provider named by `AI_PROVIDER`. Only that provider's key is
 * required, so a deployment configures one vendor rather than all three.
 */
export function createModelProvider(config: ModelProviderConfig): MotionModelProvider {
    switch (config.aiProvider) {
        case 'gemini':
            return new GeminiMotionModelProvider({ apiKey: requireKey(config.aiProvider, config.geminiApiKey) });
        case 'anthropic':
            return new AnthropicMotionModelProvider({
                apiKey: requireKey(config.aiProvider, config.anthropicApiKey),
                baseUrl: config.anthropicBaseUrl,
            });
        case 'openai-compatible':
            return new OpenAICompatibleMotionModelProvider({
                apiKey: requireKey(config.aiProvider, config.openAiCompatibleApiKey),
                baseURL: requireBaseUrl(config.openAiCompatibleBaseUrl),
            });
    }
}

function requireKey(provider: ModelProviderName, key: string | undefined): string {
    if (!key?.trim()) {
        throw new Error(`${KEY_VARIABLES[provider]} is required when AI_PROVIDER is "${provider}".`);
    }
    return key;
}

function requireBaseUrl(baseUrl: string | undefined): string {
    if (!baseUrl?.trim()) {
        throw new Error('OPENAI_COMPATIBLE_BASE_URL is required when AI_PROVIDER is "openai-compatible".');
    }
    return baseUrl;
}
