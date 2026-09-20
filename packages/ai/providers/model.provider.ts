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
    role: 'reference' | 'asset';
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

export type ModelProviderName = 'gemini' | 'openai-compatible' | 'anthropic';

export type ProviderErrorCode =
    | 'PROVIDER_RATE_LIMITED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_OUTPUT_INVALID'
    | 'PROVIDER_MODEL_UNAVAILABLE'
    | 'PROVIDER_AUTH_FAILED'
    | 'PROVIDER_ERROR';

export class ModelProviderError extends Error {
    constructor(
        public readonly code: ProviderErrorCode,
        message: string,
        public readonly retryable: boolean,
        public readonly diagnostics?: { httpStatus?: number; providerCode?: string; providerType?: string },
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

export function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
    let value: unknown;
    try { value = JSON.parse(text); } catch {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model returned invalid JSON.', false);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model output does not match the requested schema.', false);
    return parsed.data;
}

export function parseMotifyGeneration(text: string): MotifyGeneration {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', 'The model returned invalid JSON.', false);
    }

    const parsed = motifyGenerationSchema.safeParse(value);
    if (!parsed.success) {
        throw new ModelProviderError(
            'PROVIDER_OUTPUT_INVALID',
            'The model output does not match the Motify generation schema.',
            false,
        );
    }
    return parsed.data;
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
    if (error instanceof ModelProviderError) return error;
    if (signal?.aborted) {
        return new ModelProviderError('PROVIDER_TIMEOUT', 'The model request timed out or was cancelled.', false);
    }

    const status = readStatus(error);
    if (status === 401 || status === 403) {
        return new ModelProviderError('PROVIDER_AUTH_FAILED', `${provider} rejected the configured API key.`, false, diagnostics(error));
    }
    if (status === 404) {
        return new ModelProviderError('PROVIDER_MODEL_UNAVAILABLE', `The configured ${provider} model is unavailable.`, false, diagnostics(error));
    }
    if (status === 429) {
        return new ModelProviderError('PROVIDER_RATE_LIMITED', `${provider} rate limit reached.`, true, diagnostics(error));
    }
    if (status !== undefined && status >= 500) {
        return new ModelProviderError('PROVIDER_UNAVAILABLE', `${provider} is temporarily unavailable.`, true, diagnostics(error));
    }
    return new ModelProviderError('PROVIDER_ERROR', `${provider} request failed.`, false, diagnostics(error));
}

function readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    return undefined;
}

function diagnostics(error: unknown): { httpStatus?: number; providerCode?: string; providerType?: string } | undefined {
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
