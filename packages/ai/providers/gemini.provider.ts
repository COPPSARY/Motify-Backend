import {
    GoogleGenAI,
    type GenerateContentParameters,
    type GenerateContentResponse,
} from '@google/genai';
import { z } from 'zod';

import {
    motifyGenerationJsonSchema,
    lastUserMessageIndex,
    normalizeProviderError,
    parseMotifyGeneration,
    parseStructured,
    requireModelText,
    tokenUsage,
    type ChatRequest,
    type ModelGenerationResult,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';

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
                contents: request.images?.length ? [{
                    role: 'user',
                    parts: [
                        { text: request.prompt },
                        ...request.images.map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.dataBase64 } })),
                    ],
                }] : request.prompt,
                config: {
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                    systemInstruction: request.systemInstructions,
                    maxOutputTokens: request.limits.maxOutputTokens,

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
                model: request.model,
                contents: request.images?.length ? [{
                    role: 'user',
                    parts: [
                        { text: request.prompt },
                        ...request.images.map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.dataBase64 } })),
                    ],
                }] : request.prompt,
                config: {
                    ...(request.signal ? { abortSignal: request.signal } : {}),
                    systemInstruction: request.systemInstructions,
                    maxOutputTokens: request.limits.maxOutputTokens,
                    responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(request.schema, { target: 'draft-7' }),
                },
            });
            return parseStructured(requireModelText(response.text), request.schema);
        } catch (error) { throw normalizeProviderError(this.name, error, request.signal); }
    }

    async chat(request: ChatRequest): Promise<string> {
        const lastUserIndex = lastUserMessageIndex(request.messages);
        try {
            const response = await this.client.models.generateContent({
                model: request.model,
                contents: request.messages.map((message, index) => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    parts: [
                        { text: message.content },
                        ...(index === lastUserIndex ? (request.images ?? []).map((image) => ({
                            inlineData: { mimeType: image.mediaType, data: image.dataBase64 },
                        })) : []),
                    ],
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
