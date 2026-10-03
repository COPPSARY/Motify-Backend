import { describe, expect, it, vi } from 'vitest';

import type { GraphProjectRepository } from '../../../../../packages/ai/agent/dependencies.js';
import { createFinalizeGenerationTool } from '../../../../../packages/ai/agent/tools/finalize-generation.tool.js';

const generation = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    compositionHtml: '<template><style>.a{color:red}</style><div class="a" data-edit="e1"></div></template>',
    timelineJs: 'export function buildTimeline() { return {}; }',
    reply: 'Made it.',
};

function repository(): GraphProjectRepository {
    return {
        loadProjectAccess: vi.fn(async () => null),
        loadForGraph: vi.fn(async () => null),
        listRecentMessages: vi.fn(async () => []),
        createForGraph: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', revision: 1, ...generation })),
        overwriteForGraph: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', revision: 8, ...generation })),
        recordRun: vi.fn(async () => undefined),
        recordRunUsage: vi.fn(async () => undefined),
        appendMessage: vi.fn(async () => undefined),
    };
}

describe('finalize_generation tool', () => {
    it('creates a new project when no projectId was given, and reports it via onFinalized', async () => {
        const repo = repository();
        const onFinalized = vi.fn();
        const tool = createFinalizeGenerationTool({
            repository: repo as never, userId: 'u1', workspaceId: 'w1', message: 'Make it.',
            model: 'test-model', now: () => 1000, startedAtMs: 900, onFinalized,
        });

        const result = await tool.invoke(generation);

        expect(repo.createForGraph).toHaveBeenCalledWith('w1', 'u1', expect.objectContaining({ message: 'Make it.', generation }));
        expect(repo.overwriteForGraph).not.toHaveBeenCalled();
        expect(onFinalized).toHaveBeenCalledWith({ type: 'created', project: expect.objectContaining({ id: 'p1', revision: 1 }) });
        expect(JSON.parse(result as string)).toMatchObject({ status: 'saved', revision: 1 });
    });

    it('overwrites an existing project and reports the conflict when the revision is stale', async () => {
        const repo = repository();
        repo.overwriteForGraph = vi.fn(async () => null);
        const onFinalized = vi.fn();
        const tool = createFinalizeGenerationTool({
            repository: repo as never, userId: 'u1', workspaceId: 'w1', projectId: 'p1', expectedRevision: 7,
            message: 'Edit it.', model: 'test-model', now: () => 1000, startedAtMs: 900, onFinalized,
        });

        const result = await tool.invoke(generation);

        expect(onFinalized).toHaveBeenCalledWith({ type: 'conflict' });
        expect(JSON.parse(result as string)).toMatchObject({ status: 'conflict' });
    });

    it('overwrites an existing project on a matching revision', async () => {
        const repo = repository();
        const onFinalized = vi.fn();
        const tool = createFinalizeGenerationTool({
            repository: repo as never, userId: 'u1', workspaceId: 'w1', projectId: 'p1', expectedRevision: 7,
            message: 'Edit it.', model: 'test-model', now: () => 1000, startedAtMs: 900, onFinalized,
        });

        await tool.invoke(generation);

        expect(repo.overwriteForGraph).toHaveBeenCalledWith('p1', expect.objectContaining({ userId: 'u1', expectedRevision: 7, generation }));
        expect(onFinalized).toHaveBeenCalledWith({ type: 'overwritten', project: expect.objectContaining({ id: 'p1', revision: 8 }) });
    });
});
