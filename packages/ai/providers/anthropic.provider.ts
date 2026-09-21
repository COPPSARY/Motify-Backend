import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
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
    type ModelImageInput,
    type ModelRequestLimits,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';

/** Anthropic's own API. Override for a gateway that speaks the Messages API. */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export interface AnthropicProviderOptions {
    apiKey: string;
    /** A Messages API endpoint other than Anthropic's own. */
    baseUrl?: string | undefined;
    client?: Pick<Anthropic, 'messages'>;
    /** Waits between attempts after a transient overload. Tests pass zeros. */
    retryDelaysMs?: readonly number[];
}

/**
 * Two more attempts after an overload, a few seconds apart. An overload is the
 * upstream shedding load for a moment, and one such blip - seen live, during
 * skill selection - otherwise throws away every step of the turn before it.
 */
const DEFAULT_RETRY_DELAYS_MS = [2_000, 6_000] as const;

/**
 * Whether a failure is an overload worth trying again.
 *
 * Only failures that arrive inside an established stream. The SDK already
 * retries a 429 or 5xx it receives before the stream starts; an error event
 * mid-stream has no HTTP status and reaches here untouched. Deliberately not
 * the stream being cut at the gateway's time limit: that takes minutes to
 * arrive and would take minutes again.
 */
function isOverloaded(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    if ('status' in error && typeof error.status === 'number') return false;
    const body = 'error' in error ? JSON.stringify(error.error) : '';
    return /overloaded_error|"api_error"/.test(body)
        || (error instanceof Error && /overloaded_error|"api_error"/.test(error.message));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claude over the official Anthropic SDK.
 *
 * This provider used to be the OpenAI SDK pointed at Anthropic's host, talking
 * `/v1/chat/completions`. That reaches Claude only through a compatibility
 * shim, so structured output, thinking and effort all had to be expressed in
 * another vendor's vocabulary. This speaks the Messages API directly:
 * `output_config.format` for schema-valid JSON, adaptive thinking, and effort
 * as the dial for how much reasoning a call is worth.
 */
export class AnthropicMotionModelProvider implements MotionModelProvider {
    readonly name = 'anthropic' as const;
    private readonly client: Pick<Anthropic, 'messages'>;
    private readonly retryDelaysMs: readonly number[];

    constructor(options: AnthropicProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('Anthropic API key is required.');
        this.client = options.client ?? new Anthropic({
            apiKey: options.apiKey,
            baseURL: options.baseUrl?.trim() || ANTHROPIC_BASE_URL,
        });
        this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    }

    /** Runs one call, trying again after a transient overload. */
    private async attempt<T>(run: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
        for (let tries = 0; ; tries += 1) {
            try {
                return await run();
            } catch (error) {
                const wait = this.retryDelaysMs[tries];
                if (wait === undefined || !isOverloaded(error) || signal?.aborted) throw error;
                await delay(wait);
            }
        }
    }

    /**
     * Every call streams. Nothing is done with the events: `finalMessage()`
     * waits for the same message a non-streaming call would have returned.
     *
     * Two separate limits force it. The SDK refuses a non-streaming request as
     * large as a film - generation and repair allow 32,000 output tokens -
     * before it reaches the network. And a relaying gateway was measured
     * closing non-streaming requests with a 504 at about 95 seconds while
     * letting a stream run for about five minutes: the shot brief, a small
     * structured call, failed that way on every model, and because a failed
     * brief is deliberately non-fatal the film went on to be generated with
     * no brief at all and nothing in the log to say so.
     */
    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        try {
            const message = await this.attempt(() => this.client.messages.stream({
                model: request.model,
                max_tokens: request.limits.maxOutputTokens,
                system: withSchema(request.systemInstructions, motifyGenerationJsonSchema),
                messages: [userTurn(request.prompt, request.images)],
                output_config: {
                    ...effortFor(request.limits),
                    format: { type: 'json_schema', schema: motifyGenerationJsonSchema },
                },
                ...thinkingFor(request.limits),
            }, signalOptions(request.signal)).finalMessage(), request.signal);
            return {
                generation: parseMotifyGeneration(unfenced(textOf(message))),
                usage: tokenUsage(message.usage?.input_tokens, message.usage?.output_tokens),
            };
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        try {
            const schema = z.toJSONSchema(request.schema, { target: 'draft-7' }) as Record<string, unknown>;
            const message = await this.attempt(() => this.client.messages.stream({
                model: request.model,
                max_tokens: request.limits.maxOutputTokens,
                system: withSchema(request.systemInstructions, schema),
                messages: [userTurn(request.prompt, request.images)],
                output_config: {
                    ...effortFor(request.limits),
                    format: { type: 'json_schema', schema },
                },
                ...thinkingFor(request.limits),
            }, signalOptions(request.signal)).finalMessage(), request.signal);
            return parseStructured(unfenced(textOf(message)), request.schema);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const message = await this.attempt(() => this.client.messages.stream({
                model: request.model,
                max_tokens: request.limits.maxOutputTokens,
                system: request.systemInstructions,
                messages: chatTurns(request),
                output_config: effortFor(request.limits),
                ...thinkingFor(request.limits),
            }, signalOptions(request.signal)).finalMessage(), request.signal);
            return textOf(message);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}

function signalOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
    return signal ? { signal } : {};
}

/**
 * The schema, said out loud in the prompt as well as declared on the request.
 *
 * `output_config.format` is the real mechanism and is always sent. But this
 * provider is pointed at whatever Messages API endpoint is configured, and a
 * gateway that relays the call without implementing structured outputs drops
 * the schema silently: the request succeeds, and the model - never having seen
 * the schema - invents its own field names. Asked to classify an intent, it
 * answered `{"classification":"CREATE"}` where the schema said `intent`, which
 * arrives as "the model output does not match the requested schema" with no
 * hint of why.
 *
 * Restating the schema costs a few hundred tokens and makes the call correct
 * on an endpoint that honours `format` and on one that ignores it.
 */
function withSchema(systemInstructions: string, schema: Record<string, unknown>): string {
    return [
        systemInstructions,
        '',
        'OUTPUT FORMAT',
        'Reply with a single JSON object and nothing else: no prose before or after it, and no markdown code fence.',
        'It must validate against this JSON Schema, using exactly these field names:',
        JSON.stringify(schema),
    ].join('\n');
}

/**
 * The JSON in a reply that was asked for JSON.
 *
 * Unfenced output is the instruction, and mostly what arrives. A fence is the
 * one deviation common enough to be worth absorbing rather than failing a
 * whole generation over.
 */
function unfenced(text: string): string {
    const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
    return fenced?.[1] ?? text;
}

/**
 * Whether this call is worth reasoning over.
 *
 * Only `'auto'` is. Unset means the same as `'none'` here: the contract calls
 * it "the model's own default ... little or none", which was true of the lite
 * tiers this was written against and is false of Opus, where thinking is on
 * unless you say otherwise.
 *
 * That difference is not cosmetic, because thinking is billed against
 * `max_tokens`. Intent classification is allowed 128 output tokens and skill
 * selection 160; adaptive thinking spends every one of them reasoning and the
 * turn ends at `max_tokens` having emitted no text at all. The response is
 * well formed and completely empty, which reaches the user as "the model
 * returned an unusable response".
 */
function reasons(limits: ModelRequestLimits): boolean {
    return limits.thinking === 'auto';
}

/**
 * Effort, not a thinking budget: `budget_tokens` is rejected by the current
 * models. Low effort is also what keeps a thinking-off call cheap without
 * asking the model to suppress reasoning it was told not to do.
 */
function effortFor(limits: ModelRequestLimits): { effort: 'low' | 'high' } {
    return { effort: reasons(limits) ? 'high' : 'low' };
}

function thinkingFor(limits: ModelRequestLimits): { thinking: { type: 'adaptive' } | { type: 'disabled' } } {
    return { thinking: reasons(limits) ? { type: 'adaptive' } : { type: 'disabled' } };
}

function imageBlocks(images: readonly ModelImageInput[] = []): ContentBlockParam[] {
    return images.map((image) => ({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.dataBase64 },
    }));
}

function userTurn(prompt: string, images: readonly ModelImageInput[] = []): MessageParam {
    return images.length === 0
        ? { role: 'user', content: prompt }
        : { role: 'user', content: [{ type: 'text', text: prompt }, ...imageBlocks(images)] };
}

/** Images ride the newest user turn, so a conversational reply can see them. */
function chatTurns(request: ChatRequest): MessageParam[] {
    const images = request.images ?? [];
    const lastUser = request.messages.reduce(
        (found, message, index) => (message.role === 'user' ? index : found),
        -1,
    );
    return request.messages.map((message, index) => (
        message.role === 'user' && index === lastUser
            ? userTurn(message.content, images)
            : { role: message.role, content: message.content }
    ));
}

/**
 * The reply, as one string.
 *
 * A response is a list of blocks, and with thinking on the first of them is
 * usually not the answer. Only text blocks are joined: thinking is reasoning
 * about the answer rather than the answer, and handing it to a JSON parser is
 * how a sound generation comes to read as malformed output.
 *
 * Invisible format characters are trimmed from the ends. A relaying gateway
 * was seen opening every reply with a text block holding nothing but U+2060
 * (a zero-width word joiner) before the real answer: a complete, valid 10KB
 * film that `JSON.parse` rejected on its first character, because JSON allows
 * only four whitespace characters and that is not one of them. Only the ends
 * are touched - inside the answer such a character may be deliberate copy.
 */
const EDGE_INVISIBLES = /^[\s​-‏⁠-⁤﻿]+|[\s​-‏⁠-⁤﻿]+$/g;

function textOf(message: Message): string {
    const text = message.content
        .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .replace(EDGE_INVISIBLES, '');
    return requireModelText(text);
}
