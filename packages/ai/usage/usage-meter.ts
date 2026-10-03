import { AsyncLocalStorage } from 'node:async_hooks';

export interface MeteredUsage {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    /** Model calls that answered, whether or not their output was then accepted. */
    calls: number;
    /** Answered calls whose provider reported no token counts at all. */
    unreportedCalls: number;
}

/**
 * Adds up every token a single request spends across every model call it makes.
 *
 * The graph's own `tokenUsage` only sees the two nodes that return it, and it
 * is lost when a provider throws part-way through a run. Providers report to
 * the meter the moment a response arrives, before it is parsed, so a call the
 * validator later rejects still counts, and so does everything spent before a
 * failure.
 */
export class UsageMeter {
    private inputTokens = 0;
    private outputTokens = 0;
    private cachedInputTokens = 0;
    private calls = 0;
    private unreportedCalls = 0;

    record(inputTokens: number | null, outputTokens: number | null, cachedInputTokens: number | null = null): void {
        this.calls += 1;
        if (inputTokens === null && outputTokens === null) {
            this.unreportedCalls += 1;
            return;
        }
        this.inputTokens += inputTokens ?? 0;
        this.outputTokens += outputTokens ?? 0;
        this.cachedInputTokens += cachedInputTokens ?? 0;
    }

    snapshot(): MeteredUsage {
        return {
            inputTokens: this.inputTokens,
            outputTokens: this.outputTokens,
            cachedInputTokens: this.cachedInputTokens,
            calls: this.calls,
            unreportedCalls: this.unreportedCalls,
        };
    }
}

const scope = new AsyncLocalStorage<UsageMeter>();

/** Runs `work` so every model call made inside it, however deep, reports to `meter`. */
export function runWithUsageMeter<T>(meter: UsageMeter, work: () => Promise<T>): Promise<T> {
    return scope.run(meter, work);
}

/**
 * Tokens spent so far by the metered request this code is running inside, or
 * `null` counts when nothing reported usage (or there is no metered request).
 */
export function currentUsageTokens(): { inputTokens: number | null; outputTokens: number | null } {
    const usage = scope.getStore()?.snapshot();
    if (!usage || usage.calls === usage.unreportedCalls) return { inputTokens: null, outputTokens: null };
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

/**
 * Called by a provider with the token counts of a response. A no-op outside a
 * metered request (evals, scripts), so providers never need to know whether
 * anyone is counting.
 */
export function recordModelUsage(inputTokens: unknown, outputTokens: unknown, cachedInputTokens?: unknown): void {
    scope.getStore()?.record(tokenCount(inputTokens), tokenCount(outputTokens), tokenCount(cachedInputTokens));
}

function tokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
