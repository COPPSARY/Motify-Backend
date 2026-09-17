import { randomUUID } from 'node:crypto';

import { TransactionRollbackError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { MotifyGeneration } from '../../packages/ai/providers/model.provider.js';
import { createDatabase, type Database } from '../../packages/database/client.js';
import { generationRuns, users, workspaceMembers, workspaces } from '../../packages/database/schema.js';
import { DatabaseMotionGraphRepository } from '../../src/repositories/motion-graph.repository.js';

const databaseUrl = process.env.DATABASE_URL;

const generation: MotifyGeneration = {
    title: 'Launch Film',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 60,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<template><style>.intro { color: #fff; }</style><div data-edit="intro">Launch</div></template>',
    timelineJs: 'export function buildTimeline({ root, timeline }) { timeline.from(root, { opacity: 0 }); }',
    reply: 'Built the launch film.',
};

const edited: MotifyGeneration = { ...generation, title: 'Launch Film v2', reply: 'Slowed the intro.' };

describe.skipIf(!databaseUrl)('DatabaseMotionGraphRepository', () => {
    it('creates, reads, and revision-checks a generated project inside one transaction', async () => {
        if (!databaseUrl) return;
        const { db, pool } = createDatabase(databaseUrl);
        const suffix = randomUUID();
        const userId = randomUUID();
        const viewerId = randomUUID();
        const workspaceId = randomUUID();

        try {
            await expect(db.transaction(async (transaction) => {
                await transaction.insert(users).values([
                    { id: userId, email: `graph-editor-${suffix}@example.com`, displayName: 'Graph Editor' },
                    { id: viewerId, email: `graph-viewer-${suffix}@example.com`, displayName: 'Graph Viewer' },
                ]);
                await transaction.insert(workspaces).values({
                    id: workspaceId, name: 'Graph Workspace', slug: `graph-${suffix}`, kind: 'team', ownerId: userId,
                });
                await transaction.insert(workspaceMembers).values([
                    { workspaceId, userId, role: 'owner' },
                    { workspaceId, userId: viewerId, role: 'viewer' },
                ]);

                const repository = new DatabaseMotionGraphRepository(transaction as unknown as Database);

                await expect(repository.loadWorkspaceForGraph(workspaceId, userId)).resolves.toEqual({ role: 'owner' });
                await expect(repository.loadWorkspaceForGraph(workspaceId, randomUUID())).resolves.toBeNull();

                const created = await repository.createForGraph(workspaceId, userId, {
                    message: 'Make me a launch film.',
                    generation,
                    model: 'test-model',
                    selectedSkills: ['core', 'write-motify'],
                    repairAttempts: 0,
                    latencyMs: 1_234,
                    inputTokens: 1_200,
                    outputTokens: 340,
                });
                expect(created).toMatchObject({ workspaceId, title: 'Launch Film', revision: 1, scenes: generation.scenes });
                await expect(transaction.select({ inputTokens: generationRuns.inputTokens, outputTokens: generationRuns.outputTokens })
                    .from(generationRuns)).resolves.toContainEqual({ inputTokens: 1_200, outputTokens: 340 });

                await expect(repository.createForGraph(workspaceId, viewerId, {
                    message: 'Make me one too.', generation, model: 'test-model', selectedSkills: [], repairAttempts: 0, latencyMs: 10,
                    inputTokens: 5, outputTokens: 3,
                })).resolves.toBeNull();

                const projectId = created!.id;
                await expect(repository.loadForGraph(projectId, userId)).resolves.toMatchObject({
                    role: 'owner', project: { id: projectId, revision: 1, timelineJs: generation.timelineJs },
                });
                await expect(repository.loadForGraph(projectId, randomUUID())).resolves.toBeNull();

                // The request must read before its reply even though both land in one transaction.
                await expect(repository.listRecentMessages(projectId, 12)).resolves.toEqual([
                    { role: 'user', content: 'Make me a launch film.' },
                    { role: 'assistant', content: 'Built the launch film.' },
                ]);

                await expect(repository.overwriteForGraph(projectId, {
                    userId, expectedRevision: 99, intent: 'EDIT', generation: edited,
                    model: 'test-model', selectedSkills: ['core'], repairAttempts: 0, latencyMs: 50,
                    inputTokens: 6, outputTokens: 4,
                })).resolves.toBeNull();

                const overwritten = await repository.overwriteForGraph(projectId, {
                    userId, expectedRevision: 1, intent: 'EDIT', generation: edited,
                    model: 'test-model', selectedSkills: ['core'], repairAttempts: 1, latencyMs: 2_000,
                    inputTokens: 700, outputTokens: 200,
                });
                expect(overwritten).toMatchObject({ id: projectId, title: 'Launch Film v2', revision: 2 });

                await expect(repository.listRecentMessages(projectId, 12)).resolves.toEqual([
                    { role: 'user', content: 'Make me a launch film.' },
                    { role: 'assistant', content: 'Built the launch film.' },
                    { role: 'assistant', content: 'Slowed the intro.' },
                ]);

                await repository.recordRun({
                    projectId, baseRevision: 2, savedRevision: null, intent: 'FIX', model: 'test-model',
                    selectedSkills: ['core'], repairAttempts: 2, status: 'FAILED', latencyMs: 3_000,
                    inputTokens: 900, outputTokens: 300,
                });

                transaction.rollback();
            })).rejects.toBeInstanceOf(TransactionRollbackError);
        } finally {
            await pool.end();
        }
    });
});
