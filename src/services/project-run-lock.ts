import { randomUUID } from 'node:crypto';

import { AppError } from '../errors.js';

export interface RunLeaseStore {
    /** True when the lease was taken (none held, or the previous one expired). */
    acquire(projectId: string, holder: string, ttlMs: number): Promise<boolean>;
    /** Releases only if `holder` still owns it. Never throws for "not held". */
    release(projectId: string, holder: string): Promise<void>;
}

/**
 * Leases held in this process. Enough for one server instance; a deployment with several
 * instances would need a store they share.
 */
export class InMemoryRunLeaseStore implements RunLeaseStore {
    private readonly leases = new Map<string, { holder: string; until: number }>();

    constructor(private readonly now: () => number = () => Date.now()) {}

    async acquire(projectId: string, holder: string, ttlMs: number): Promise<boolean> {
        const current = this.leases.get(projectId);
        if (current && current.until > this.now()) return false;
        this.leases.set(projectId, { holder, until: this.now() + ttlMs });
        return true;
    }

    async release(projectId: string, holder: string): Promise<void> {
        if (this.leases.get(projectId)?.holder === holder) this.leases.delete(projectId);
    }
}

export type RunLock = <T>(projectId: string, work: () => Promise<T>) => Promise<T>;

/** Longer than any run can last (billing sweeps stale holds at the same age), so a live run keeps its lease. */
export const RUN_LEASE_TTL_MS = 15 * 60 * 1000;

/**
 * One generation per project at a time: the agent's thread is shared per project,
 * so two simultaneous runs would interleave in it. A crashed run's lease expires.
 * If the lease store itself is unavailable (for example the migration has not been
 * applied yet) the work runs unlocked and `onStoreError` hears about it: a broken
 * bookkeeping table must not take generation down.
 */
export function createProjectRunLock(
    store: RunLeaseStore,
    ttlMs: number = RUN_LEASE_TTL_MS,
    onStoreError?: (error: unknown) => void,
): RunLock {
    return async <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
        const holder = randomUUID();
        let acquired: boolean;
        try {
            acquired = await store.acquire(projectId, holder, ttlMs);
        } catch (error) {
            onStoreError?.(error);
            return work();
        }
        if (!acquired) {
            throw new AppError(409, 'GENERATION_IN_PROGRESS', 'A generation is already running for this project.');
        }
        try {
            return await work();
        } finally {
            // The lease expires on its own; a failed release must not turn a finished run into an error.
            await store.release(projectId, holder).catch(() => undefined);
        }
    };
}
