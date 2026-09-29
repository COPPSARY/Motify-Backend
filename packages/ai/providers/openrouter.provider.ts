import { OpenRouter } from '@openrouter/sdk';
import type { ChatMessages, ChatResult } from '@openrouter/sdk/models';
import { z } from 'zod';

import {
    motifyGenerationJsonSchema,
    lastUserMessageIndex,
    normalizeProviderError,
    parseMotifyGeneration,
    parseStructured,
    requestSignalOptions,
    tokenUsage,
    truncateForLog,
    withSchemaPrompt,
    ModelProviderError,
    type ChatRequest,
    type ModelGenerationResult,
    type ModelImageInput,
    type ModelRequestLimits,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';
import { recordModelUsage } from '../usage/usage-meter.js';

/** OpenRouter's own Chat Completions endpoint. Override for a self-hosted proxy in front of it. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * By default OpenRouter treats `responseFormat` as a soft preference: if no
 * healthy provider currently supports it, the request still routes to one
 * that doesn't and either ignores the schema or emulates it, occasionally
 * responding with an empty `message.content` (the JSON schema, when honoured
 * at all, comes back as a tool call instead - see the fallback in
 * `extractText` below). `requireParameters` turns that into a hard filter,
 * so a structured request never lands on a provider that cannot honour it.
 */
const REQUIRE_SCHEMA_SUPPORT = { requireParameters: true } as const;

/** The SDK types every `chat.send` call as possibly-streaming; this provider never sets `stream`. */
type ChatSendResult = Awaited<ReturnType<OpenRouter['chat']['send']>>;

export interface OpenRouterProviderOptions {
    apiKey: string;
    /** An OpenRouter-compatible gateway other than OpenRouter's own. */
    baseURL?: string | undefined;
    /** Sent as HTTP-Referer for OpenRouter's attribution/rankings. Optional. */
    siteUrl?: string | undefined;
    /** Sent as X-Title for OpenRouter's attribution/rankings. Optional. */
    appName?: string | undefined;
    client?: Pick<OpenRouter, 'chat'>;
}

/**
 * Speaks OpenRouter's own Chat Completions API through OpenRouter's official
 * TypeScript SDK, so routing, model naming ("vendor/model") and error shapes
 * all follow OpenRouter's own conventions rather than an OpenAI compatibility
 * shim.
 */
export class OpenRouterMotionModelProvider implements MotionModelProvider {
    readonly name = 'openrouter' as const;
    private readonly client: Pick<OpenRouter, 'chat'>;

    constructor(options: OpenRouterProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('OpenRouter API key is required.');
        this.client = options.client ?? new OpenRouter({
            apiKey: options.apiKey,
            serverURL: options.baseURL?.trim() || OPENROUTER_BASE_URL,
            ...(options.siteUrl?.trim() ? { httpReferer: options.siteUrl.trim() } : {}),
            ...(options.appName?.trim() ? { appTitle: options.appName.trim() } : {}),
        });
    }

    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        try {
            const response = await this.client.chat.send({
                chatRequest: {
                    model: request.model,
                    messages: promptMessages(withSchemaPrompt(request.systemInstructions, motifyGenerationJsonSchema), request.prompt, request.images),
                    maxCompletionTokens: request.limits.maxOutputTokens,
                    ...reasoningFor(request.limits),
                    responseFormat: {
                        type: 'json_schema',
                        jsonSchema: {
                            name: 'motify_generation',
                            strict: true,
                            schema: motifyGenerationJsonSchema,
                        },
                    },
                    provider: REQUIRE_SCHEMA_SUPPORT,
                },
            }, ...requestSignalOptions(request.signal));
            const result = requireChatResult(response);
            recordModelUsage(result.usage?.promptTokens, result.usage?.completionTokens);
            return {
                generation: parseMotifyGeneration(extractText(result)),
                usage: tokenUsage(result.usage?.promptTokens, result.usage?.completionTokens),
            };
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        try {
            const schema = z.toJSONSchema(request.schema, { target: 'draft-7' }) as Record<string, unknown>;
            const response = await this.client.chat.send({
                chatRequest: {
                    model: request.model,
                    messages: promptMessages(withSchemaPrompt(request.systemInstructions, schema), request.prompt, request.images),
                    maxCompletionTokens: request.limits.maxOutputTokens,
                    ...reasoningFor(request.limits),
                    responseFormat: {
                        type: 'json_schema',
                        jsonSchema: {
                            name: request.schemaName,
                            strict: true,
                            schema,
                        },
                    },
                    provider: REQUIRE_SCHEMA_SUPPORT,
                },
            }, ...requestSignalOptions(request.signal));
            const result = requireChatResult(response);
            recordModelUsage(result.usage?.promptTokens, result.usage?.completionTokens);
            return parseStructured(extractText(result), request.schema);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const response = await this.client.chat.send({
                chatRequest: {
                    model: request.model,
                    messages: [
                        { role: 'system', content: request.systemInstructions },
                        ...chatMessagesWithImages(request.messages, request.images),
                    ],
                    maxCompletionTokens: request.limits.maxOutputTokens,
                    ...reasoningFor(request.limits),
                },
            }, ...requestSignalOptions(request.signal));
            const result = requireChatResult(response);
            recordModelUsage(result.usage?.promptTokens, result.usage?.completionTokens);
            return extractText(result);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}

/**
 * OpenRouter's `reasoning.effort` is the one knob it exposes across every
 * routed vendor's native thinking/reasoning parameter. Without it, a model
 * that reasons by default whenever the parameter is omitted (Claude Sonnet 5
 * routed through OpenRouter does; see `anthropic.provider.ts`'s `thinkingFor`,
 * which disables thinking explicitly for the same reason) can spend the
 * entire `maxCompletionTokens` budget on hidden reasoning and return no
 * content at all - fatal for the small budgets used by intent/routing calls,
 * and seen live even at a 64k generation budget: `high` is documented as
 * spending as many tokens as the task needs, with no ceiling of its own.
 * `low` is the officially recommended cost-saving step-down; start there.
 */
function reasoningFor(limits: ModelRequestLimits): { reasoning: { effort: 'low' | 'none' } } {
    return { reasoning: { effort: limits.thinking === 'auto' ? 'low' : 'none' } };
}

function promptMessages(
    systemInstructions: string,
    prompt: string,
    images: MotionModelRequest['images'] = [],
): ChatMessages[] {
    return [
        { role: 'system', content: systemInstructions },
        {
            role: 'user',
            content: !images?.length ? prompt : [
                { type: 'text', text: prompt },
                ...images.map((image) => ({
                    type: 'image_url' as const,
                    imageUrl: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
                })),
            ],
        },
    ];
}

/** Attaches images to the newest user message so a conversational reply can see them. */
function chatMessagesWithImages(
    messages: ChatRequest['messages'],
    images: readonly ModelImageInput[] = [],
): ChatMessages[] {
    const lastUser = lastUserMessageIndex(messages);
    return messages.map((message, index) => {
        if (message.role === 'assistant') return { role: 'assistant', content: message.content };
        if (index !== lastUser || images.length === 0) return { role: 'user', content: message.content };
        return {
            role: 'user',
            content: [
                { type: 'text', text: message.content },
                ...images.map((image) => ({
                    type: 'image_url' as const,
                    imageUrl: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
                })),
            ],
        };
    });
}

/** The SDK's `stream` option defaults to non-streaming; this rejects the streaming branch of its return type as a safety net. */
function requireChatResult(response: ChatSendResult): ChatResult {
    if (!('choices' in response)) {
        throw new ModelProviderError('PROVIDER_ERROR', 'OpenRouter returned a streaming response for a non-streaming request.', false);
    }
    return response;
}

type MessageContent = ChatResult['choices'][number]['message']['content'];

/**
 * OpenRouter types assistant content as `string | ChatContentItems[] | null`
 * (`@openrouter/sdk/models/chatassistantmessage.js`) - some routed models return
 * the array form (one or more `{ type: 'text', text }` parts) even for a plain
 * text/JSON reply, not only for genuinely empty or refused turns.
 */
function contentText(content: MessageContent): string | undefined {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    const text = content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
    return text.length > 0 ? text : undefined;
}

/**
 * Some routed providers implement `responseFormat` by forcing a tool call
 * rather than complying in the message body, leaving `content` null with the
 * JSON schema's answer sitting in the first tool call's arguments instead.
 * `REQUIRE_SCHEMA_SUPPORT` should keep this from happening, but a provider
 * can still advertise the parameter and honour it this way, so it is read
 * here as a fallback rather than trusted to never occur.
 */
function toolCallText(message: ChatResult['choices'][number]['message']): string | undefined {
    const args = message.toolCalls?.[0]?.function.arguments;
    return args?.trim() ? args : undefined;
}

function extractText(response: ChatResult): string {
    const choice = response.choices[0];
    const message = choice?.message;
    const text = contentText(message?.content) ?? toolCallText(message ?? { role: 'assistant' });
    if (text?.trim()) return text;
    throw new ModelProviderError(
        'PROVIDER_OUTPUT_INVALID',
        'The model returned an empty response.',
        false,
        {
            cause: `message.content: ${truncateForLog(JSON.stringify(message?.content))}, `
                + `finishReason: ${choice?.finishReason ?? 'unknown'}, `
                + `reasoning: ${message?.reasoning ? `${message.reasoning.length} chars` : 'none'}, `
                + `toolCalls: ${message?.toolCalls?.length ?? 0}`,
        },
    );
}
