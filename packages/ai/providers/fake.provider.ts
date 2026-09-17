import {
    ModelProviderError,
    motionlyGenerationSchema,
    type ChatRequest,
    type ModelGenerationResult,
    type MotionlyGeneration,
    type MotionModelProvider,
    type MotionModelRequest,
    parseStructured,
    tokenUsage,
    type StructuredModelRequest,
} from './model.provider.js';

export interface FakeProviderScript {
    generation: unknown | ((request: MotionModelRequest) => unknown | Promise<unknown>);
    chat: string | ((request: ChatRequest) => string | Promise<string>);
    structured?: unknown | ((request: StructuredModelRequest<unknown>) => unknown | Promise<unknown>);
}

export class FakeMotionModelProvider implements MotionModelProvider {
    readonly name = 'gemini' as const;

    constructor(private readonly script: FakeProviderScript) {}

    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        requireActive(request.signal);
        const value = typeof this.script.generation === 'function'
            ? await this.script.generation(request)
            : this.script.generation;
        const candidate = isGenerationResult(value) ? value.generation : value;
        const parsed = motionlyGenerationSchema.safeParse(candidate);
        if (!parsed.success) {
            throw new ModelProviderError(
                'PROVIDER_OUTPUT_INVALID',
                'The fake model output does not match the Motionly generation schema.',
                false,
            );
        }
        return {
            generation: parsed.data,
            usage: isGenerationResult(value)
                ? tokenUsage(value.usage.inputTokens, value.usage.outputTokens)
                : tokenUsage(undefined, undefined),
        };
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        requireActive(request.signal);
        const value = typeof this.script.structured === 'function'
            ? await this.script.structured(request)
            : this.script.structured;
        return parseStructured(JSON.stringify(value), request.schema);
    }

    async chat(request: ChatRequest): Promise<string> {
        requireActive(request.signal);
        return typeof this.script.chat === 'function' ? this.script.chat(request) : this.script.chat;
    }
}

function isGenerationResult(value: unknown): value is { generation: unknown; usage: { inputTokens: unknown; outputTokens: unknown } } {
    return Boolean(value && typeof value === 'object' && 'generation' in value && 'usage' in value);
}

function requireActive(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new ModelProviderError('PROVIDER_TIMEOUT', 'The model request timed out or was cancelled.', false);
    }
}
