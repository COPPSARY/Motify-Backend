import { describe, expect, it } from 'vitest';

import { createProjectRunLock, InMemoryRunLeaseStore, type RunLeaseStore } from '../../../src/services/project-run-lock.js';

function memoryStore(): RunLeaseStore & { held: Map<string, string> } {
    const held = new Map<string, string>();
    return {
        held,
        async acquire(projectId, holder) {
            if (held.has(projectId)) return false;
            held.set(projectId, holder);
            return true;
        },
        async release(projectId, holder) {
            if (held.get(projectId) === holder) held.delete(projectId);
        },
    };
}

describe('createProjectRunLock', () => {
    it('runs the work and releases the lease afterwards', async () => {
        const store = memoryStore();
        const lock = createProjectRunLock(store);

        await expect(lock('p1', async () => 'done')).resolves.toBe('done');

        expect(store.held.size).toBe(0);
    });

    it('rejects a second concurrent run for the same project with 409 and never runs its work', async () => {
        const store = memoryStore();
        const lock = createProjectRunLock(store);
        let release!: () => void;
        const first = lock('p1', () => new Promise<void>((resolve) => { release = resolve; }));
        await Promise.resolve();
        let secondRan = false;

        const second = lock('p1', async () => { secondRan = true; });

        await expect(second).rejects.toMatchObject({ status: 409, code: 'GENERATION_IN_PROGRESS' });
        expect(secondRan).toBe(false);
        release();
        await first;
    });

    it('lets different projects run at the same time', async () => {
        const lock = createProjectRunLock(memoryStore());
        let release!: () => void;
        const first = lock('p1', () => new Promise<void>((resolve) => { release = resolve; }));
        await Promise.resolve();

        await expect(lock('p2', async () => 'ok')).resolves.toBe('ok');
        release();
        await first;
    });

    it('releases the lease when the work throws', async () => {
        const store = memoryStore();
        const lock = createProjectRunLock(store);

        await expect(lock('p1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

        expect(store.held.size).toBe(0);
    });

    it('does not fail the request when releasing the lease fails', async () => {
        const store = memoryStore();
        store.release = async () => { throw new Error('db down'); };
        const lock = createProjectRunLock(store);

        await expect(lock('p1', async () => 'done')).resolves.toBe('done');
    });

    it('runs the work unlocked, and reports the failure, when the lease store itself is unavailable', async () => {
        const store = memoryStore();
        store.acquire = async () => { throw new Error('relation "project_run_leases" does not exist'); };
        const errors: unknown[] = [];
        const lock = createProjectRunLock(store, undefined, (error) => errors.push(error));

        await expect(lock('p1', async () => 'done')).resolves.toBe('done');

        expect(errors).toHaveLength(1);
    });
});

describe('InMemoryRunLeaseStore', () => {
    it('grants one holder at a time per project', async () => {
        const store = new InMemoryRunLeaseStore();

        expect(await store.acquire('p1', 'a', 60_000)).toBe(true);
        expect(await store.acquire('p1', 'b', 60_000)).toBe(false);
        expect(await store.acquire('p2', 'b', 60_000)).toBe(true);
    });

    it('lets only the holder release', async () => {
        const store = new InMemoryRunLeaseStore();
        await store.acquire('p1', 'a', 60_000);

        await store.release('p1', 'b');
        expect(await store.acquire('p1', 'b', 60_000)).toBe(false);

        await store.release('p1', 'a');
        expect(await store.acquire('p1', 'b', 60_000)).toBe(true);
    });

    it('grants the lease again once it has expired', async () => {
        let clock = 1_000;
        const store = new InMemoryRunLeaseStore(() => clock);
        await store.acquire('p1', 'a', 5_000);

        clock += 5_001;

        expect(await store.acquire('p1', 'b', 5_000)).toBe(true);
    });
});
