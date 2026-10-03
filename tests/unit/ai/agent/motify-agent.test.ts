import { describe, expect, it, vi } from 'vitest';

vi.mock('deepagents', () => ({
    createDeepAgent: vi.fn(),
    FilesystemBackend: vi.fn(),
    StateBackend: vi.fn(),
    CompositeBackend: vi.fn(),
}));

import { createDeepAgent } from 'deepagents';
import { createMotifyAgentRunner } from '../../../../packages/ai/agent/motify-agent.js';
import type { GraphProjectRepository, MotifyProject } from '../../../../packages/ai/agent/dependencies.js';
import { ModelProviderError } from '../../../../packages/ai/agent/errors.js';
import { recordModelUsage, runWithUsageMeter, UsageMeter } from '../../../../packages/ai/usage/usage-meter.js';

const generation = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    compositionHtml: '<template><style>.a{color:red}</style><div class="a"></div></template>',
    timelineJs: 'export function buildTimeline() { return {}; }',
    reply: 'Made it.',
};

function repository(overrides: Partial<GraphProjectRepository> = {}): GraphProjectRepository {
    return {
        loadProjectAccess: vi.fn(async () => ({ workspaceId: 'w1', role: 'editor' as const })),
        loadForGraph: vi.fn(async () => null),
        listRecentMessages: vi.fn(async () => []),
        appendMessage: vi.fn(async () => undefined),
        createForGraph: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', revision: 1, ...generation })),
        overwriteForGraph: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', revision: 2, ...generation })),
        recordRun: vi.fn(async () => undefined),
        recordRunUsage: vi.fn(async () => undefined),
        ...overrides,
    };
}

/**
 * Finds the `finalize_generation` tool the runner built and passed into
 * `createDeepAgent({ tools })`. Simpler than the `configurable.__test_finalize`
 * seam sketched in the brief: the runner never wires such a seam through
 * config, and this way exercises the real tool object end to end (see the
 * "Note for the implementer" in task-12-brief.md — the behavior under test is
 * the finalize_generation -> MotionGraphResponse translation, not the mock
 * plumbing).
 */
function findFinalizeTool(): { invoke(input: unknown): Promise<string> } {
    const call = vi.mocked(createDeepAgent).mock.calls.at(-1)?.[0] as { tools?: Array<{ name: string; invoke(input: unknown): Promise<string> }> } | undefined;
    const found = call?.tools?.find((toolCandidate) => toolCandidate.name === 'finalize_generation');
    if (!found) throw new Error('finalize_generation tool was not passed to createDeepAgent');
    return found;
}

function latestAgentConfig(): { systemPrompt?: string; skills?: string[]; tools?: Array<{ name: string }> } {
    const config = vi.mocked(createDeepAgent).mock.calls.at(-1)?.[0];
    if (!config) throw new Error('createDeepAgent was not called');
    return config as { systemPrompt?: string; skills?: string[]; tools?: Array<{ name: string }> };
}

describe('createMotifyAgentRunner', () => {
    it('uses the normal skill-enabled harness and environment step cap for an ordinary generation', async () => {
        const invoke = vi.fn(async () => ({ messages: [{ content: 'Drafted it.' }] }));
        vi.mocked(createDeepAgent).mockReturnValue({ invoke } as never);

        const runner = createMotifyAgentRunner({
            model: {} as never,
            repository: repository(),
            skillsRoot: '/skills-root',
            maxSteps: 50,
            audioSearch: vi.fn(async () => []),
            mcpTools: [{ name: 'text_to_speech' } as never],
        });

        await runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Make a logo reveal.' });

        const config = latestAgentConfig();
        expect(config.systemPrompt).toMatch(/You are Motify Agent, the model behind Motify/);
        expect(config.skills).toEqual(['/skills/']);
        expect(config.tools?.map((candidate) => candidate.name)).toEqual([
            'validate_generation', 'finalize_generation', 'search_audio_library', 'text_to_speech',
        ]);
        expect(invoke).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recursionLimit: 50 }));
    });

    it('returns a chat response when the agent calls finalize_generation, then appends the assistant reply and records the run', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                // Simulate the agent calling the finalize_generation tool mid-run.
                await findFinalizeTool().invoke(generation);
                return { messages: [{ content: 'Made it.' }] };
            }),
        } as never);

        const repo = repository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        const result = await runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Make a logo reveal.' });

        expect(result.response).toMatchObject({ type: 'generation', projectId: 'p1', revision: 1, created: true });
        // createForGraph/overwriteForGraph already append the assistant reply
        // and record the run inside their own transaction (see the doc comment
        // on GraphProjectRepository) — the runner itself must not double-write.
        expect(repo.appendMessage).not.toHaveBeenCalled();
        expect(repo.recordRun).not.toHaveBeenCalled();
    });

    it('stores the whole run token usage on the saved run, including calls made after finalize', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                recordModelUsage(1000, 200);
                await findFinalizeTool().invoke(generation);
                recordModelUsage(1500, 50);
                return { messages: [{ content: 'Made it.' }] };
            }),
        } as never);

        const repo = repository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        await runWithUsageMeter(new UsageMeter(), () => runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Make a logo reveal.' }));

        expect(repo.recordRunUsage).toHaveBeenCalledWith({ projectId: 'p1', savedRevision: 1, inputTokens: 2500, outputTokens: 250 });
    });

    it('returns PROJECT_NOT_FOUND when the addressed project does not exist', async () => {
        const repo = repository({ loadForGraph: vi.fn(async () => null) });
        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        const result = await runner.invoke({ userId: 'u1', workspaceId: 'w1', projectId: 'missing', message: 'Edit it.' });

        expect(result.response).toMatchObject({ type: 'error', code: 'PROJECT_NOT_FOUND' });
    });

    it('returns GENERATION_INVALID when the step budget is exhausted without a finalize_generation call', async () => {
        const { GraphRecursionError } = await import('@langchain/langgraph');
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => { throw new GraphRecursionError('too many steps'); }),
        } as never);

        const repo = repository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root', maxSteps: 5 });

        const result = await runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Make it.' });

        expect(result.response).toMatchObject({ type: 'error', code: 'GENERATION_INVALID' });
    });

    it('returns a plain chat response when the agent never finalizes and just replies', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => ({ messages: [{ content: 'Sure, what should it say?' }] })),
        } as never);

        const repo = repository();
        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        const result = await runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Can you help me?' });

        expect(result.response).toEqual({ type: 'chat', message: 'Sure, what should it say?' });
    });

    it('a non-GraphRecursionError thrown from agent.invoke() surfaces as a ModelProviderError with the right code, not a raw error', async () => {
        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                const error = new Error('Too Many Requests') as Error & { status: number };
                error.status = 429;
                throw error;
            }),
        } as never);

        const repo = repository();
        const runner = createMotifyAgentRunner({
            model: {} as never,
            repository: repo,
            skillsRoot: '/skills-root',
            providerName: 'openai-compatible',
        });

        let caught: unknown;
        try {
            await runner.invoke({ userId: 'u1', workspaceId: 'w1', message: 'Make it.' });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(ModelProviderError);
        expect(caught).toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true, provider: 'openai-compatible' });
    });

    it('a second finalize_generation call in the same run after a success does not report a false conflict over the already-saved project', async () => {
        const existingProject: MotifyProject = { id: 'p1', workspaceId: 'w1', revision: 1, ...generation };
        const repo = repository({
            loadForGraph: vi.fn(async () => ({ project: existingProject, role: 'editor' as const })),
            overwriteForGraph: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', revision: 2, ...generation })),
        });

        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => {
                // Simulate the agent calling finalize_generation twice in one run.
                await findFinalizeTool().invoke(generation);
                await findFinalizeTool().invoke(generation);
                return { messages: [{ content: 'Made it.' }] };
            }),
        } as never);

        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        const result = await runner.invoke({
            userId: 'u1',
            workspaceId: 'w1',
            projectId: 'p1',
            message: 'Slow the intro down.',
            revision: 1,
        });

        expect(result.response).toMatchObject({ type: 'generation', created: false, revision: 2 });
        // The second call must be a no-op against the repository: it must not
        // reuse the stale expectedRevision captured at construction time and
        // get a spurious conflict that overwrites the first call's success.
        expect(repo.overwriteForGraph).toHaveBeenCalledTimes(1);
    });

    it('an existing-project chat-only turn (no finalize) appends both the user message and the assistant reply', async () => {
        const existingProject: MotifyProject = { id: 'p1', workspaceId: 'w1', revision: 3, ...generation };
        const repo = repository({
            loadForGraph: vi.fn(async () => ({ project: existingProject, role: 'editor' as const })),
        });

        vi.mocked(createDeepAgent).mockReturnValue({
            invoke: vi.fn(async () => ({ messages: [{ content: 'Sure, what should it say?' }] })),
        } as never);

        const runner = createMotifyAgentRunner({ model: {} as never, repository: repo, skillsRoot: '/skills-root' });

        const result = await runner.invoke({
            userId: 'u1',
            workspaceId: 'w1',
            projectId: 'p1',
            message: 'What have we built so far?',
        });

        expect(result.response).toEqual({ type: 'chat', message: 'Sure, what should it say?' });
        expect(repo.appendMessage).toHaveBeenCalledTimes(2);
        expect(repo.appendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: 'user', content: 'What have we built so far?' }));
        expect(repo.appendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: 'assistant', content: 'Sure, what should it say?' }));
    });
});
