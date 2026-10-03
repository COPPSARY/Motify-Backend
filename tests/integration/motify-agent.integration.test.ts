import { describe, expect, it, vi } from 'vitest';

vi.mock('deepagents', () => ({
    createDeepAgent: vi.fn(),
    FilesystemBackend: vi.fn(),
    StateBackend: vi.fn(),
    CompositeBackend: vi.fn(),
}));

import { createDeepAgent } from 'deepagents';

import { createMotifyAgentRunner } from '../../packages/ai/agent/motify-agent.js';
import type {
    CreateGraphProjectInput,
    GenerationRunInput,
    GraphProjectRepository,
    GraphWorkspaceRole,
    MotifyAgentDependencies,
    MotifyProject,
    OverwriteGraphProjectInput,
    StoredMessageInput,
} from '../../packages/ai/agent/dependencies.js';
import type { MotifyGeneration } from '../../packages/ai/agent/generation-schema.js';
import { AppError } from '../../src/errors.js';
import { GenerationService } from '../../src/services/generation.service.js';

const WORKSPACE_ID = 'workspace-1';

const generation: MotifyGeneration = {
    title: 'Launch Film',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 60,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<template><style>.intro{color:#fff}</style><div data-edit="intro">Launch</div></template>',
    timelineJs: 'export function buildTimeline({ root, timeline }) { timeline.from(root, { opacity: 0 }); }',
    reply: 'Built the launch film.',
};

/**
 * A small, stateful stand-in for `DatabaseMotionGraphRepository`, used in
 * place of a real Postgres connection (no `DATABASE_URL` is configured for
 * this run — see `tests/integration/motion-graph.repository.test.ts`'s own
 * `describe.skipIf`). It honors the same contract the database
 * implementation does: `overwriteForGraph` only writes when the caller's
 * `expectedRevision` matches the stored row, exactly like the `WHERE
 * revision = $expectedRevision` guard in `motion-graph.repository.ts`. That
 * makes it a faithful enough stand-in for exercising `createMotifyAgentRunner`
 * end to end: a real row is created/read/revision-checked, not merely a
 * mocked function call.
 */
class InMemoryGraphProjectRepository implements GraphProjectRepository {
    private project: MotifyProject | undefined;
    private nextId = 0;
    readonly messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    readonly runs: GenerationRunInput[] = [];

    constructor(seed?: MotifyProject) {
        this.project = seed;
    }

    async loadWorkspaceForGraph(_workspaceId: string, _userId: string): Promise<{ role: GraphWorkspaceRole } | null> {
        return { role: 'editor' };
    }

    async loadProjectAccess(projectId: string, _userId: string): Promise<{ workspaceId: string; role: GraphWorkspaceRole } | null> {
        if (!this.project || this.project.id !== projectId) return null;
        return { workspaceId: this.project.workspaceId, role: 'editor' };
    }

    async loadForGraph(projectId: string, _userId: string): Promise<{ project: MotifyProject; role: GraphWorkspaceRole } | null> {
        if (!this.project || this.project.id !== projectId) return null;
        return { project: this.project, role: 'editor' };
    }

    async listRecentMessages(_projectId: string, limit: number) {
        return this.messages.slice(-limit);
    }

    async appendMessage(input: StoredMessageInput) {
        this.messages.push({ role: input.role, content: input.content });
    }

    async createForGraph(workspaceId: string, _userId: string, input: CreateGraphProjectInput): Promise<MotifyProject | null> {
        this.nextId += 1;
        const project: MotifyProject = {
            id: `project-${this.nextId}`,
            workspaceId,
            title: input.generation.title,
            duration: input.generation.duration,
            width: input.generation.width,
            height: input.generation.height,
            fps: input.generation.fps,
            scenes: input.generation.scenes,
            compositionHtml: input.generation.compositionHtml,
            timelineJs: input.generation.timelineJs,
            revision: 1,
        };
        this.project = project;
        this.messages.push({ role: 'user', content: input.message });
        this.messages.push({ role: 'assistant', content: input.generation.reply });
        return project;
    }

    async overwriteForGraph(projectId: string, input: OverwriteGraphProjectInput): Promise<MotifyProject | null> {
        if (!this.project || this.project.id !== projectId || this.project.revision !== input.expectedRevision) {
            // Mirrors the database repository's `WHERE revision = $expectedRevision`
            // guard: a stale revision writes nothing and reports a conflict.
            return null;
        }
        const updated: MotifyProject = {
            ...this.project,
            title: input.generation.title,
            duration: input.generation.duration,
            width: input.generation.width,
            height: input.generation.height,
            fps: input.generation.fps,
            scenes: input.generation.scenes,
            compositionHtml: input.generation.compositionHtml,
            timelineJs: input.generation.timelineJs,
            revision: this.project.revision + 1,
        };
        this.project = updated;
        this.messages.push({ role: 'assistant', content: input.generation.reply });
        return updated;
    }

    async recordRun(input: GenerationRunInput) {
        this.runs.push(input);
    }

    async recordRunUsage(): Promise<void> {}
}

/**
 * Finds the `finalize_generation` tool the runner built and passed into
 * `createDeepAgent({ tools })` on its most recent call, mirroring the pattern
 * `tests/unit/ai/agent/motify-agent.test.ts` (Task 12) already established.
 */
function findFinalizeTool(): { invoke(input: unknown): Promise<string> } {
    const call = vi.mocked(createDeepAgent).mock.calls.at(-1)?.[0] as { tools?: Array<{ name: string; invoke(input: unknown): Promise<string> }> } | undefined;
    const found = call?.tools?.find((toolCandidate) => toolCandidate.name === 'finalize_generation');
    if (!found) throw new Error('finalize_generation tool was not passed to createDeepAgent');
    return found;
}

describe('Motify agent integration', () => {
    it('CREATE with no projectId: the fake model calls finalize_generation and a new row exists afterward', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                await findFinalizeTool().invoke(generation);
                return { messages: [{ content: generation.reply }] };
            }),
        } as never);

        const graphRepository = new InMemoryGraphProjectRepository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: graphRepository, skillsRoot: '/skills-root' });

        const result = await runner.invoke({ userId: 'user-1', workspaceId: WORKSPACE_ID, message: 'Make me a launch film.' });

        expect(result.response).toMatchObject({ type: 'generation', created: true, revision: 1 });
        const response = result.response;
        const projectId = response?.type === 'generation' ? response.projectId : undefined;
        expect(projectId).toBeDefined();

        const loaded = await graphRepository.loadForGraph(projectId!, 'user-1');
        expect(loaded).not.toBeNull();
        expect(loaded?.project).toMatchObject({ id: projectId, title: generation.title, revision: 1 });
    });

    it('EDIT with a stale revision: returns REVISION_CONFLICT and leaves the row untouched', async () => {
        const seed: MotifyProject = {
            id: 'project-existing',
            workspaceId: WORKSPACE_ID,
            title: 'Original Title',
            duration: generation.duration,
            width: generation.width,
            height: generation.height,
            fps: generation.fps,
            scenes: generation.scenes,
            compositionHtml: generation.compositionHtml,
            timelineJs: generation.timelineJs,
            revision: 5,
        };
        const graphRepository = new InMemoryGraphProjectRepository(seed);

        const edited: MotifyGeneration = { ...generation, title: 'Edited Title', reply: 'Edited it.' };
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                await findFinalizeTool().invoke(edited);
                return { messages: [{ content: edited.reply }] };
            }),
        } as never);

        const runner = createMotifyAgentRunner({ model: {} as never, repository: graphRepository, skillsRoot: '/skills-root' });

        const result = await runner.invoke({
            userId: 'user-1',
            workspaceId: WORKSPACE_ID,
            projectId: seed.id,
            message: 'Slow the intro down.',
            revision: 1, // deliberately stale: the stored row is at revision 5
        });

        expect(result.response).toEqual({
            type: 'error',
            code: 'REVISION_CONFLICT',
            message: 'The project changed since you loaded it.',
            currentRevision: 5,
        });

        const loaded = await graphRepository.loadForGraph(seed.id, 'user-1');
        expect(loaded?.project).toMatchObject({ title: 'Original Title', revision: 5 });
    });

    it('a viewer-role user is rejected with 403 FORBIDDEN before the real agent runner, the model, or any project read is ever touched', async () => {
        // This is the hard guardrail from spec §3.3: GenerationService checks
        // workspace access itself, before the agent runner is ever invoked.
        // Unlike a hand-rolled `{ invoke: vi.fn() }` stub (which only proves
        // *some* function wasn't called), this wires the REAL
        // `createMotifyAgentRunner` — the same production path server.ts
        // uses, including passing one repository instance as both the
        // runner's `repository` and `GenerationService`'s `projects` — with a
        // spy model and a spied repository, so the assertions below prove
        // the guardrail runs outside agent judgment specifically: neither
        // `createDeepAgent` (the only way the runner reaches LangGraph/the
        // model), the model itself, nor the repository's own
        // project-loading methods are ever reached.
        const modelGenerate = vi.fn();
        const fakeModel = { _generate: modelGenerate, invoke: vi.fn() } as unknown as MotifyAgentDependencies['model'];

        const graphRepository = new InMemoryGraphProjectRepository();
        const loadForGraphSpy = vi.spyOn(graphRepository, 'loadForGraph');
        const loadProjectAccessSpy = vi.spyOn(graphRepository, 'loadProjectAccess')
            .mockResolvedValue({ workspaceId: WORKSPACE_ID, role: 'viewer' as const });

        const runner = createMotifyAgentRunner({ model: fakeModel, repository: graphRepository, skillsRoot: '/skills-root' });
        // Same wiring server.ts uses: one repository serves both roles.
        const service = new GenerationService(runner, graphRepository);

        const call = service.sendMessage('viewer-user', 'project-1', { message: 'Change the title.' });
        await expect(call).rejects.toBeInstanceOf(AppError);
        await expect(call).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

        expect(loadProjectAccessSpy).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createDeepAgent)).not.toHaveBeenCalled();
        expect(modelGenerate).not.toHaveBeenCalled();
        expect(loadForGraphSpy).not.toHaveBeenCalled();
    });

    it('a fake model that never calls any tool just replies with a plain chat response', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => ({ messages: [{ content: 'Sure, tell me more about the film you want.' }] })),
        } as never);

        const graphRepository = new InMemoryGraphProjectRepository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: graphRepository, skillsRoot: '/skills-root' });

        const result = await runner.invoke({ userId: 'user-1', workspaceId: WORKSPACE_ID, message: 'Can you help me?' });

        expect(result.response).toEqual({ type: 'chat', message: 'Sure, tell me more about the film you want.' });
    });
});
