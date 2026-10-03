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

function readStatus(error: unknown, depth = 0): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    if ('status' in error && typeof error.status === 'number') return error.status;
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
    // LangChain/deepagents wrap the SDK error (e.g. `RateLimitCapacityError`),
    // leaving the HTTP status on a nested `cause`.
    const nested = depth < 3 && 'cause' in error ? readStatus(error.cause, depth + 1) : undefined;
    if (nested !== undefined) return nested;
    if (error instanceof Error && error.name.startsWith('RateLimit')) return 429;
    // The graph re-wraps a thrown error and drops its `status`; the message is
    // what survives. SDKs lead it with the status ("429 ...", "401 {...}") and
    // some bracket it ("[429 Too Many Requests]"). Only those positions count,
    // so a number elsewhere in a message is never read as a status.
    return error instanceof Error ? statusFromMessage(error.message) : undefined;
}

function statusFromMessage(message: string): number | undefined {
    const match = /^(\d{3})\b/.exec(message) ?? /\[(\d{3}) [A-Za-z ]+\]/.exec(message);
    if (!match) return undefined;
    const status = Number(match[1]);
    return status >= 400 && status <= 599 ? status : undefined;
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
