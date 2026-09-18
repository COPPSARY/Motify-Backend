import OpenAI from 'openai';
import type {
    ChatCompletion,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { z } from 'zod';

import {
    motifyGenerationJsonSchema,
    chatMessagesWithImages,
    normalizeProviderError,
    parseMotifyGeneration,
    parseStructured,
    requireModelText,
    requestSignalOptions,
    tokenUsage,
    type ChatRequest,
    type ModelGenerationResult,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';

interface OpenAICompatibleClient {
    chat: {
        completions: {
            create(
                body: ChatCompletionCreateParamsNonStreaming,
                options?: { signal?: AbortSignal },
            ): Promise<ChatCompletion>;
        };
    };
}

export interface OpenAICompatibleProviderOptions {
    apiKey: string;
    baseURL: string;
    client?: OpenAICompatibleClient;
}

/**
 * Speaks the OpenAI Chat Completions API, which any OpenAI-compatible gateway
 * (official OpenAI included) implements. Point `baseURL` at whichever gateway
 * is configured to switch providers without a code change.
 */
export class OpenAICompatibleMotionModelProvider implements MotionModelProvider {
    readonly name = 'openai-compatible' as const;
    private readonly client: OpenAICompatibleClient;

    constructor(options: OpenAICompatibleProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('OpenAI-compatible API key is required.');
        if (!options.baseURL.trim()) throw new Error('OpenAI-compatible base URL is required.');
        this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    }

    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        try {
            const response = await this.client.chat.completions.create({
                model: request.model,
                messages: promptMessages(request.systemInstructions, request.prompt, request.images),
                max_completion_tokens: request.limits.maxOutputTokens,

                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'motify_generation',
                        strict: true,
                        schema: motifyGenerationJsonSchema,
                    },
                },
            }, ...requestSignalOptions(request.signal));
            return {
                generation: parseMotifyGeneration(extractText(response)),
                usage: tokenUsage(response.usage?.prompt_tokens, response.usage?.completion_tokens),
            };
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        try {
            const response = await this.client.chat.completions.create({
                model: request.model,
                messages: promptMessages(request.systemInstructions, request.prompt, request.images),
                max_completion_tokens: request.limits.maxOutputTokens,

                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: request.schemaName,
                        strict: true,
                        schema: z.toJSONSchema(request.schema, { target: 'draft-7' }),
                    },
                },
            }, ...requestSignalOptions(request.signal));
            return parseStructured(extractText(response), request.schema);
        } catch (error) { throw normalizeProviderError(this.name, error, request.signal); }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: request.model,
                messages: [{ role: 'system', content: request.systemInstructions }, ...chatMessagesWithImages(request.messages, request.images)],
                max_completion_tokens: request.limits.maxOutputTokens,

            }, ...requestSignalOptions(request.signal));
            return extractText(response);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}

function promptMessages(
    systemInstructions: string,
    prompt: string,
    images: MotionModelRequest['images'] = [],
): ChatCompletionMessageParam[] {
    return [
        { role: 'system', content: systemInstructions },
        {
            role: 'user',
            content: !images?.length ? prompt : [
                { type: 'text', text: prompt },
                ...images.map((image) => ({
                    type: 'image_url' as const,
                    image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
                })),
            ],
        },
    ];
}

function extractText(response: ChatCompletion): string {
    return requireModelText(response.choices[0]?.message?.content ?? undefined);
}
