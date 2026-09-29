import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';

import {
    ModelProviderError,
    motifyGenerationJsonSchema,
    normalizeProviderError,
    parseMotifyGeneration,
    parseStructured,
    tokenUsage,
    withSchemaPrompt,
    type ChatRequest,
    type ModelGenerationResult,
    type ModelImageInput,
    type ModelRequestLimits,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';
import { recordModelUsage } from '../usage/usage-meter.js';

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
                system: withSchemaPrompt(request.systemInstructions, motifyGenerationJsonSchema),
                messages: [userTurn(request.prompt, request.images)],
                output_config: {
                    ...effortFor(request.limits),
                    format: { type: 'json_schema', schema: ANTHROPIC_GENERATION_SCHEMA },
                },
                ...thinkingFor(request.limits),
            }, signalOptions(request.signal)).finalMessage(), request.signal);
            recordAnthropicUsage(message);
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
                system: withSchemaPrompt(request.systemInstructions, schema),
                messages: [userTurn(request.prompt, request.images)],
                output_config: {
                    ...effortFor(request.limits),
                    format: { type: 'json_schema', schema: anthropicCompatibleSchema(schema) as Record<string, unknown> },
                },
                ...thinkingFor(request.limits),
            }, signalOptions(request.signal)).finalMessage(), request.signal);
            recordAnthropicUsage(message);
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
            recordAnthropicUsage(message);
            return textOf(message);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}

/** Cached input is counted in full: a slight overcharge, never an undercharge. */
function recordAnthropicUsage(message: Message): void {
    const usage = message.usage;
    if (!usage) return recordModelUsage(undefined, undefined);
    recordModelUsage(
        (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        usage.output_tokens,
    );
}

function signalOptions(signal: AbortSignal | undefined): { signal?: AbortSignal } {
    return signal ? { signal } : {};
}

/**
 * `output_config.format` accepts only a restricted subset of JSON Schema: no
 * numeric bounds, no string length or pattern constraints, no `maxItems`, and
 * `minItems` only at 0 or 1 - anything else is a 400 (seen live: `beats.max(6)`
 * and a skill-selection `.max(5)` both surfaced as "property 'maxItems' is not
 * supported"). The Zod schemas keep their real constraints; `parseStructured`
 * and `parseMotifyGeneration` validate the parsed response against those in
 * full. This only trims what Anthropic would reject from the copy of the
 * schema it is told to constrain generation against - the same tradeoff
 * Anthropic's own SDKs make for their `messages.parse()` helper.
 */
const DROPPED_SCHEMA_KEYS = new Set([
    'minLength', 'maxLength', 'pattern',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'maxItems', 'uniqueItems',
]);

function anthropicCompatibleSchema(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(anthropicCompatibleSchema);
    if (node === null || typeof node !== 'object') return node;
    const entries = Object.entries(node as Record<string, unknown>)
        .filter(([key, value]) => {
            if (DROPPED_SCHEMA_KEYS.has(key)) return false;
            if (key === 'minItems') return typeof value === 'number' && value <= 1;
            return true;
        })
        .map(([key, value]) => [key, anthropicCompatibleSchema(value)] as const);
    return Object.fromEntries(entries);
}

/** Computed once: the generation schema never changes between calls. */
const ANTHROPIC_GENERATION_SCHEMA = anthropicCompatibleSchema(motifyGenerationJsonSchema) as Record<string, unknown>;

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
 * models. `high` is documented as spending as many tokens as the task
 * needs, with no ceiling of its own - a request that overthinks can hit
 * `max_tokens` with nothing but a `thinking` block to show for it regardless
 * of how large that ceiling is. `low` is the officially recommended
 * cost-saving step-down; start there and raise it only if evals show it
 * costs real quality on this task.
 */
function effortFor(_limits: ModelRequestLimits): { effort: 'low' } {
    return { effort: 'low' };
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

/**
 * A `tool_use` block never appears here in normal operation: this provider
 * declares no `tools`, so nothing should call one. It exists as the same
 * defense-in-depth as `withSchemaPrompt` above - a relaying gateway that emulates
 * `output_config.format` for a model that lacks native support can do so by
 * forcing a tool call, which leaves every text block empty with the schema's
 * answer sitting in a tool call's `input` instead.
 */
function toolUseInput(message: Message): string | undefined {
    const block = message.content.find(
        (candidate): candidate is Extract<Message['content'][number], { type: 'tool_use' }> => candidate.type === 'tool_use',
    );
    return block ? JSON.stringify(block.input) : undefined;
}

function textOf(message: Message): string {
    const text = message.content
        .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .replace(EDGE_INVISIBLES, '');
    if (text.trim()) return text;
    const fallback = toolUseInput(message);
    if (fallback?.trim()) return fallback;
    const thinkingChars = message.content
        .filter((block): block is Extract<Message['content'][number], { type: 'thinking' }> => block.type === 'thinking')
        .reduce((sum, block) => sum + block.thinking.length, 0);
    throw new ModelProviderError(
        'PROVIDER_OUTPUT_INVALID',
        'The model returned an empty response.',
        false,
        {
            cause: `stopReason: ${message.stop_reason ?? 'unknown'}, `
                + `blocks: ${message.content.map((block) => block.type).join(',') || 'none'}, `
                + `thinking: ${thinkingChars > 0 ? `${thinkingChars} chars` : 'none'}`,
        },
    );
}
