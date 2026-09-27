import { z } from 'zod';

const sceneTrackSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(['Text', 'Element', 'SVG', 'Background', 'Camera']),
    start: z.number().nonnegative(),
    end: z.number().positive(),
}).strict();

const sceneShape = {
    id: z.string().min(1),
    label: z.string().min(1),
    start: z.number().nonnegative(),
    duration: z.number().positive(),
    accent: z.string().min(1),
};

const sceneSchema = z.object({
    ...sceneShape,
    tracks: z.array(sceneTrackSchema).optional(),
}).strict();

const providerSceneSchema = z.object({
    ...sceneShape,
    tracks: z.array(sceneTrackSchema),
}).strict();

export const motifyGenerationSchema = z.object({
    title: z.string().min(1),
    duration: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    scenes: z.array(sceneSchema),
    compositionHtml: z.string().min(1),
    timelineJs: z.string().min(1),
    reply: z.string().min(1),
}).strict();

const providerGenerationSchema = motifyGenerationSchema.extend({
    scenes: z.array(providerSceneSchema),
});

export const motifyGenerationJsonSchema = z.toJSONSchema(providerGenerationSchema, {
    target: 'draft-7',
});

export type MotifyGeneration = z.infer<typeof motifyGenerationSchema>;

export interface ModelTokenUsage {
    inputTokens: number | null;
    outputTokens: number | null;
}

export interface ModelGenerationResult {
    generation: MotifyGeneration;
    usage: ModelTokenUsage;
}

export interface ModelRequestLimits {
    maxOutputTokens: number;
    /**
     * How much reasoning the request is worth. Authoring or repairing a film is
     * the reasoning; classification and routing are not. Left unset, the model's
     * own default applies - which on the lite tiers means little or none.
     */
    thinking?: 'auto' | 'none';
}

export interface ModelImageInput {
    assetId: string;
    fileName: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    dataBase64: string;
    /**
     * What the image is to this generation. An `asset` is placed in the film
     * and a `reference` is imitated, so both describe something the user
     * supplied. A `frame` is neither: it is a picture of the candidate this
     * request is repairing, rendered by the editor, and the one thing the
     * model must not do with it is reproduce it.
     */
    role: 'reference' | 'asset' | 'frame';
    /** Where in the film a `frame` was taken, in seconds. */
    capturedAtSeconds?: number;
}

export interface MotionModelRequest {
    model: string;
    systemInstructions: string;
    prompt: string;
    limits: ModelRequestLimits;
    images?: readonly ModelImageInput[];
    signal?: AbortSignal;
}

export interface StructuredModelRequest<T> extends MotionModelRequest {
    schemaName: string;
    schema: z.ZodType<T>;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface ChatRequest {
    model: string;
    systemInstructions: string;
    messages: ChatMessage[];
    limits: ModelRequestLimits;
    images?: readonly ModelImageInput[];
    signal?: AbortSignal;
}

export type ImageChatMessage =
    | { role: 'assistant'; content: string }
    | {
        role: 'user';
        content: string | Array<
            { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
        >;
    };

export function lastUserMessageIndex(messages: readonly ChatMessage[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user') return index;
    }
    return -1;
}

/** Attaches images to the newest user message so a conversational reply can see them. */
export function chatMessagesWithImages(
    messages: readonly ChatMessage[],
    images: readonly ModelImageInput[] = [],
): ImageChatMessage[] {
    const lastUser = lastUserMessageIndex(messages);
    return messages.map((message, index) => {
        if (message.role === 'assistant' || index !== lastUser || images.length === 0) {
            return message.role === 'assistant'
                ? { role: 'assistant', content: message.content }
                : { role: 'user', content: message.content };
        }
        return {
            role: 'user',
            content: [
                { type: 'text', text: message.content },
                ...images.map((image) => ({
                    type: 'image_url' as const,
                    image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
                })),
            ],
        };
    });
}

export type ModelProviderName = 'gemini' | 'openai-compatible' | 'anthropic' | 'openrouter';

export type ProviderErrorCode =
    | 'PROVIDER_RATE_LIMITED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_OUTPUT_INVALID'
    | 'PROVIDER_MODEL_UNAVAILABLE'
    | 'PROVIDER_AUTH_FAILED'
    | 'PROVIDER_ERROR';

export interface ProviderDiagnostics {
    httpStatus?: number;
    providerCode?: string;
    providerType?: string;
    /**
     * What actually went wrong, when nothing above says. A failure with no
     * HTTP status - a dropped connection, a stream cut mid-film, an error
     * event inside the stream - lands in the catch-all `PROVIDER_ERROR`, and
     * without this the log reads "request failed" and nothing else.
     */
    cause?: string;
}

export class ModelProviderError extends Error {
    constructor(
        public readonly code: ProviderErrorCode,
        message: string,
        public readonly retryable: boolean,
        public readonly diagnostics?: ProviderDiagnostics,
        /**
         * Which provider raised this. Unset when thrown by a shared helper
         * (`parseStructured`, `parseMotifyGeneration`, `requireModelText`) that
         * has no provider context of its own - `normalizeProviderError` fills
         * it in from the provider that called it.
         */
        public provider?: ModelProviderName,
    ) {
        super(message);
        this.name = 'ModelProviderError';
    }
}

export interface MotionModelProvider {
    readonly name: ModelProviderName;
    structured<T>(request: StructuredModelRequest<T>): Promise<T>;
    generate(request: MotionModelRequest): Promise<ModelGenerationResult>;
    chat(request: ChatRequest): Promise<string>;
}

export function tokenUsage(inputTokens: unknown, outputTokens: unknown): ModelTokenUsage {
    return {
        inputTokens: normalizeTokenCount(inputTokens),
        outputTokens: normalizeTokenCount(outputTokens),
    };
}

function normalizeTokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * The schema, said out loud in the prompt as well as declared on the request.
 *
 * The provider-level constraint (`output_config.format`, `response_format`,
 * `responseJsonSchema`) is the real enforcement mechanism and is always sent
 * alongside this. But every provider here can be pointed at a gateway or
 * routed to an upstream endpoint that relays the call without honouring
 * structured output: the request still succeeds, and a model that never saw
 * the schema invents its own field names. Asked to classify an intent, one
 * answered `{"classification":"CREATE"}` where the schema said `intent`,
 * which arrives as "the model output does not match the requested schema"
 * with no hint of why.
 *
 * Restating the schema costs a few hundred tokens and makes the call correct
 * on an endpoint that honours the constraint and on one that ignores it.
 */
export function withSchemaPrompt(systemInstructions: string, schema: Record<string, unknown>): string {
    return [
        systemInstructions,
        '',
        'OUTPUT FORMAT',
        'Reply with a single JSON object and nothing else: no prose before or after it, and no markdown code fence.',
        'It must validate against this JSON Schema, using exactly these field names:',
        JSON.stringify(schema),
    ].join('\n');
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
    let value: unknown;
    try { value = JSON.parse(text); } catch {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model returned invalid JSON.', false, { cause: truncateForLog(text) });
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model output does not match the requested schema.', false, { cause: summarizeSchemaIssues(parsed.error) });
    }
    return parsed.data;
}

export function parseMotifyGeneration(text: string): MotifyGeneration {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model returned invalid JSON.', false, { cause: describeJsonParseFailure(text, error) });
    }

    const parsed = motifyGenerationSchema.safeParse(value);
    if (!parsed.success) {
        throw new ModelProviderError(
            'PROVIDER_OUTPUT_INVALID',
            'The model output does not match the Motify generation schema.',
            false,
            { cause: summarizeSchemaIssues(parsed.error) },
        );
    }
    return parsed.data;
}

/**
 * Where the JSON actually broke, not just the head of a response that can run
 * to tens of KB once `compositionHtml`/`timelineJs` are inside it. V8 reports
 * the failing character's offset ("Unexpected token ... in JSON at position
 * N", "Unexpected non-whitespace character after JSON at position N"); a
 * window around that offset shows the actual defect - an unescaped quote, a
 * stray control character, a truncated string - instead of 300 characters of
 * syntactically fine JSON that came before it. Falls back to the truncated
 * head when the message carries no position (e.g. "Unexpected end of JSON
 * input", which means the response was cut off, not malformed mid-stream).
 */
function describeJsonParseFailure(text: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(message)?.[1];
    if (position === undefined) return `${message}: ${truncateForLog(text)}`;
    const index = Number(position);
    const windowStart = Math.max(0, index - 150);
    const windowEnd = Math.min(text.length, index + 150);
    return `${message} (chars ${windowStart}-${windowEnd} of ${text.length}): ${text.slice(windowStart, windowEnd)}`;
}

/**
 * Truncated model output for the `cause` diagnostic. Bounded like
 * `describeCause` below - this is a server log, not a user-facing message,
 * but a film's `compositionHtml`/`timelineJs` can run to tens of KB and
 * shouldn't blow up the log line just to show where the JSON broke.
 */
export function truncateForLog(text: string, maxLength = 300): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)} … (${text.length} chars total)` : text;
}

/** Which fields failed and how, not the whole (potentially large) value that failed. */
function summarizeSchemaIssues(error: z.ZodError, maxIssues = 5): string {
    const issues = error.issues
        .slice(0, maxIssues)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
    return error.issues.length > maxIssues ? `${issues}; …(${error.issues.length} issues total)` : issues;
}

export function requireModelText(text: string | undefined): string {
    if (!text?.trim()) {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model returned an empty response.', false);
    }
    return text;
}

export function requestSignalOptions(signal: AbortSignal | undefined): [] | [{ signal: AbortSignal }] {
    return signal ? [{ signal }] : [];
}

export function normalizeProviderError(
    provider: ModelProviderName,
    error: unknown,
    signal?: AbortSignal,
): ModelProviderError {
    if (error instanceof ModelProviderError) {
        error.provider ??= provider;
        return error;
    }
    if (signal?.aborted) {
        return new ModelProviderError('PROVIDER_TIMEOUT', 'The model request timed out or was cancelled.', false, undefined, provider);
    }

    const status = readStatus(error);
    if (status === 401 || status === 403) {
        return new ModelProviderError('PROVIDER_AUTH_FAILED', `${provider} rejected the configured API key.`, false, diagnostics(error), provider);
    }
    if (status === 404) {
        return new ModelProviderError('PROVIDER_MODEL_UNAVAILABLE', `The configured ${provider} model is unavailable.`, false, diagnostics(error), provider);
    }
    if (status === 429) {
        return new ModelProviderError('PROVIDER_RATE_LIMITED', `${provider} rate limit reached.`, true, diagnostics(error), provider);
    }
    if (status !== undefined && status >= 500) {
        return new ModelProviderError('PROVIDER_UNAVAILABLE', `${provider} is temporarily unavailable.`, true, diagnostics(error), provider);
    }
    // An overload reported inside a stream carries no HTTP status, so the
    // checks above cannot see it. It is the upstream shedding load, the same
    // condition a 503 describes, and the user should be told to retry.
    if (/overloaded_error/.test(JSON.stringify((error as { error?: unknown }).error ?? '')) || (error instanceof Error && /overloaded_error/.test(error.message))) {
        return new ModelProviderError('PROVIDER_UNAVAILABLE', `${provider} is temporarily unavailable.`, true, diagnostics(error), provider);
    }
    const cause = describeCause(error);
    return new ModelProviderError('PROVIDER_ERROR', `${provider} request failed.`, false, {
        ...diagnostics(error),
        ...(cause !== undefined ? { cause } : {}),
    }, provider);
}

function readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    return undefined;
}

function diagnostics(error: unknown): ProviderDiagnostics | undefined {
    const httpStatus = readStatus(error);
    const providerCode = readProviderErrorField(error, 'code');
    const providerType = readProviderErrorField(error, 'type');
    if (httpStatus === undefined && providerCode === undefined && providerType === undefined) return undefined;
    return {
        ...(httpStatus !== undefined ? { httpStatus } : {}),
        ...(providerCode !== undefined ? { providerCode } : {}),
        ...(providerType !== undefined ? { providerType } : {}),
    };
}

function readProviderErrorField(error: unknown, field: 'code' | 'type'): string | undefined {
    if (!error || typeof error !== 'object' || !('error' in error)) return undefined;
    const value = error.error;
    if (!value || typeof value !== 'object' || !(field in value)) return undefined;
    const fieldValue = (value as Record<string, unknown>)[field];
    if (typeof fieldValue !== 'string') return undefined;
    return /^[a-zA-Z0-9._-]{1,128}$/.test(fieldValue) ? fieldValue : undefined;
}

/**
 * The error's class and message, bounded. Provider SDK messages name the
 * failure ("terminated", "Connection error.", "overloaded_error") and never
 * carry the request's credentials, which is what makes them safe to log.
 */
function describeCause(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const inner = error.cause instanceof Error ? ` <- ${error.cause.name}: ${error.cause.message}` : '';
    return `${error.name}: ${error.message}${inner}`.replace(/\s+/g, ' ').slice(0, 300);
}
