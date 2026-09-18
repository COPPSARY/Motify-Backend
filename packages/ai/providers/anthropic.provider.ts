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

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

interface AnthropicClient {
    chat: {
        completions: {
            create(
                body: ChatCompletionCreateParamsNonStreaming,
                options?: { signal?: AbortSignal },
            ): Promise<ChatCompletion>;
        };
    };
}

export interface AnthropicProviderOptions {
    apiKey: string;
    client?: AnthropicClient;
}

/**
 * The configured Anthropic gateway exposes an OpenAI-compatible
 * `/chat/completions` endpoint.
 */
export class AnthropicMotionModelProvider implements MotionModelProvider {
    readonly name = 'anthropic' as const;
    private readonly client: AnthropicClient;

    constructor(options: AnthropicProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('Anthropic API key is required.');
        this.client = options.client ?? new OpenAI({
            apiKey: options.apiKey,
            baseURL: ANTHROPIC_BASE_URL,
        });
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
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const response = await this.client.chat.completions.create({
                model: request.model,
                messages: [
                    { role: 'system', content: request.systemInstructions },
                    ...chatMessagesWithImages(request.messages, request.images),
                ],
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
            content: images.length === 0 ? prompt : [
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
