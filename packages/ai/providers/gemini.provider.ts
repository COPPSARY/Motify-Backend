import {
    GoogleGenAI,
    type GenerateContentParameters,
    type GenerateContentResponse,
} from '@google/genai';
import { z } from 'zod';

import {
    motifyGenerationJsonSchema,
    normalizeProviderError,
    parseMotifyGeneration,
    parseStructured,
    requireModelText,
    tokenUsage,
    type ChatRequest,
    type ModelGenerationResult,
    type ModelRequestLimits,
    type PromptImage,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';

/**
 * Gemini takes a token budget rather than a mode: -1 lets the model choose, 0
 * disables. An unset budget leaves the model's per-tier default in place.
 */
/**
 * Gemini takes a prompt as either a string or a parts array. Reference images
 * lead so the model has seen them before it reads what to do with them.
 */
function promptContents(prompt: string, images: readonly PromptImage[] | undefined) {
    if (!images?.length) return prompt;
    return [{
        role: 'user',
        parts: [
            ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } })),
            { text: prompt },
        ],
    }];
}

function thinkingConfig(limits: ModelRequestLimits) {
    if (limits.thinking === undefined) return {};
    return { thinkingConfig: { thinkingBudget: limits.thinking === 'auto' ? -1 : 0 } };
}

interface GeminiClient {
    models: {
        generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse>;
    };
}

export interface GeminiProviderOptions {
    apiKey: string;
    client?: GeminiClient;
}

export class GeminiMotionModelProvider implements MotionModelProvider {
    readonly name = 'gemini' as const;
    private readonly client: GeminiClient;

    constructor(options: GeminiProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('Gemini API key is required.');
        this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    }

    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        try {
            const response = await this.client.models.generateContent({
                model: request.model,
                contents: promptContents(request.prompt, request.images),
                config: {
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                    systemInstruction: request.systemInstructions,
                    maxOutputTokens: request.limits.maxOutputTokens,
                    ...thinkingConfig(request.limits),
                    responseMimeType: 'application/json',
                    responseJsonSchema: motifyGenerationJsonSchema,
                },
            });
            return {
                generation: parseMotifyGeneration(requireModelText(response.text)),
                usage: tokenUsage(response.usageMetadata?.promptTokenCount, response.usageMetadata?.candidatesTokenCount),
            };
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        try {
            const response = await this.client.models.generateContent({
                model: request.model, contents: request.prompt,
                config: {
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                    systemInstruction: request.systemInstructions,
                    maxOutputTokens: request.limits.maxOutputTokens,
                    ...thinkingConfig(request.limits),
                    responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(request.schema, { target: 'draft-7' }),
                },
            });
            return parseStructured(requireModelText(response.text), request.schema);
        } catch (error) { throw normalizeProviderError(this.name, error, request.signal); }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const response = await this.client.models.generateContent({
                model: request.model,
                contents: request.messages.map((message) => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: message.content }],
                })),
                config: {
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                    systemInstruction: request.systemInstructions,
                    maxOutputTokens: request.limits.maxOutputTokens,

                },
            });
            return requireModelText(response.text);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}
