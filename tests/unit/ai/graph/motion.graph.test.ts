import { describe, expect, it, vi } from 'vitest';

import type {
    CreateGraphProjectInput,
    GraphProjectRepository,
    MotionGraphInput,
    MotifyProject,
    OverwriteGraphProjectInput,
} from '../../../../packages/ai/graph/dependencies.js';
import { createMotionGraph } from '../../../../packages/ai/graph/motion.graph.js';
import { FakeMotionModelProvider } from '../../../../packages/ai/providers/fake.provider.js';
import type { MotifyGeneration, MotionModelRequest, StructuredModelRequest } from '../../../../packages/ai/providers/model.provider.js';
import type { Intent } from '../../../../packages/ai/schemas/intent.schema.js';
import { loadSkillBundle } from '../../../../packages/motify-skills/loader.js';

const currentProject: MotifyProject = {
    id: 'proj_1',
    workspaceId: 'ws_1',
    title: 'Launch',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [],
    compositionHtml: '<template><style>.hero { color: white; }</style><main data-edit="stage"></main></template>',
    timelineJs: 'export function buildTimeline() { return []; }',
    revision: 7,
};

const validCandidate: MotifyGeneration = {
    title: 'Launch',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<template><style>.hero { color: white; }</style><main data-edit="stage"><h1 data-edit="title">Launch</h1></main></template>',
    timelineJs: 'export function buildTimeline({ timeline }) { return timeline; }',
    reply: 'Made the headline larger.',
};

const invalidCandidate: MotifyGeneration = {
    ...validCandidate,
    timelineJs: 'export function buildTimeline() { fetch("https://example.test"); }',
};

function applyGeneration(base: MotifyProject, generation: MotifyGeneration, revision: number): MotifyProject {
    return {
        ...base,
        title: generation.title,
        duration: generation.duration,
        width: generation.width,
        height: generation.height,
        fps: generation.fps,
        scenes: generation.scenes,
        compositionHtml: generation.compositionHtml,
        timelineJs: generation.timelineJs,
        revision,
    };
}

interface HarnessOptions {
    intent?: Intent;
    chat?: string;
    candidates?: MotifyGeneration[];
    project?: MotifyProject | null;
    role?: 'owner' | 'editor' | 'viewer';
    history?: { role: 'user' | 'assistant'; content: string }[];
    canCreate?: boolean;
    selectedSkillIds?: string[];
}

function createHarness(options: HarnessOptions = {}) {
    const project = options.project === undefined ? currentProject : options.project;
    const candidates = options.candidates ?? [validCandidate];
    const generateRequests: MotionModelRequest[] = [];
    let candidateIndex = 0;

    const provider = new FakeMotionModelProvider({
        structured: (request: StructuredModelRequest<unknown>) => request.schemaName === 'motify_skill_selection'
            ? { skillIds: options.selectedSkillIds ?? ['technical-data'] }
            : { intent: options.intent ?? 'EDIT' },
        chat: options.chat ?? 'Motify is ready.',
        generation: (request: MotionModelRequest) => {
            generateRequests.push(request);
            const candidate = candidates[Math.min(candidateIndex, candidates.length - 1)];
            candidateIndex += 1;
            return candidate;
        },
    });

    const repository: GraphProjectRepository = {
        loadProjectAccess: vi.fn(async () => ({ workspaceId: currentProject.workspaceId, role: options.role ?? 'editor' })),
        loadForGraph: vi.fn(async () => (project ? { project, role: options.role ?? 'editor' } : null)),
        listRecentMessages: vi.fn(async () => options.history ?? []),
        appendMessage: vi.fn(async () => {}),
        createForGraph: vi.fn(async (workspaceId: string, _userId: string, createInput: CreateGraphProjectInput) => (
            options.canCreate === false
                ? null
                : applyGeneration({ ...currentProject, id: 'proj_new', workspaceId }, createInput.generation, 1)
        )),
        overwriteForGraph: vi.fn(async (_projectId: string, overwriteInput: OverwriteGraphProjectInput) => (
            project && overwriteInput.expectedRevision === project.revision
                ? applyGeneration(project, overwriteInput.generation, project.revision + 1)
                : null
        )),
        recordRun: vi.fn(async () => {}),
    };

    const onSkillsSelected = vi.fn();
    const graph = createMotionGraph({
        provider,
        repository,
        model: 'fake-model',
        onSkillsSelected,
    });
    const structured = vi.spyOn(provider, 'structured');

    return { graph, provider, repository, generateRequests, structured, onSkillsSelected };
}

function input(message: string, overrides: Partial<MotionGraphInput> = {}): MotionGraphInput {
    return { userId: 'user_1', workspaceId: 'ws_1', projectId: 'proj_1', message, ...overrides };
}

/** A generation request that addresses a workspace only, with no project yet. */
function workspaceInput(message: string): MotionGraphInput {
    return { userId: 'user_1', workspaceId: 'ws_1', message };
}

describe('createMotionGraph', () => {
    it('uses the AI intent classifier for a workspace greeting', async () => {
        const harness = createHarness({ intent: 'CHAT', chat: 'Hello! What would you like to make?' });

        const result = await harness.graph.invoke(workspaceInput('Hello'));

        expect(harness.structured).toHaveBeenCalledTimes(1);
        expect(result.intent).toBe('CHAT');
        expect(result.response).toEqual({ type: 'chat', message: 'Hello! What would you like to make?' });
        expect(harness.repository.createForGraph).not.toHaveBeenCalled();
    });

    it('uses the AI intent classifier for a project greeting without writing project state', async () => {
        const harness = createHarness({ intent: 'CHAT', chat: 'Hi! What would you like to create?' });

        const result = await harness.graph.invoke(input('hello'));

        expect(result.response).toEqual({ type: 'chat', message: 'Hi! What would you like to create?' });
        expect(harness.structured).toHaveBeenCalledTimes(1);
        expect(harness.repository.loadForGraph).not.toHaveBeenCalled();
        expect(harness.repository.overwriteForGraph).not.toHaveBeenCalled();
        expect(harness.onSkillsSelected).not.toHaveBeenCalled();
    });

    it('replaces a provider chat refusal with a useful greeting', async () => {
        const harness = createHarness({
            intent: 'CHAT',
            chat: "Sorry, it looks like I can't respond to this. Let's try a different topic.",
        });

        const result = await harness.graph.invoke(input('hii'));

        expect(result.response).toEqual({
            type: 'chat',
            message: 'Hi! What would you like to create today?',
        });
        expect(harness.repository.loadForGraph).not.toHaveBeenCalled();
        expect(harness.repository.overwriteForGraph).not.toHaveBeenCalled();
    });

    it('returns a plan without loading context or writing project state', async () => {
        const harness = createHarness({ intent: 'PLAN', chat: 'Scene 1 logo, scene 2 headline.' });

        const result = await harness.graph.invoke(input('Plan a 10-second launch animation without changing it.'));

        expect(result.response).toEqual({ type: 'plan', message: 'Scene 1 logo, scene 2 headline.' });
        expect(harness.repository.loadForGraph).not.toHaveBeenCalled();
        expect(harness.repository.overwriteForGraph).not.toHaveBeenCalled();
        expect(harness.repository.recordRun).not.toHaveBeenCalled();
        expect(harness.onSkillsSelected).not.toHaveBeenCalled();
    });

    it('atomically overwrites the project with a validated candidate', async () => {
        const harness = createHarness({ intent: 'EDIT' });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.response).toEqual({
            type: 'generation',
            message: 'Made the headline larger.',
            projectId: 'proj_1',
            revision: 8,
            created: false,
        });
        expect(harness.repository.overwriteForGraph).toHaveBeenCalledWith('proj_1', expect.objectContaining({
            userId: 'user_1',
            intent: 'EDIT',
            expectedRevision: 7,
            repairAttempts: 0,
            model: 'fake-model',
            generation: validCandidate,
        }));
    });

    it('records accumulated provider token usage with a completed generation run', async () => {
        const harness = createHarness({
            intent: 'EDIT',
            candidates: [{ generation: validCandidate, usage: { inputTokens: 1_200, outputTokens: 340 } } as unknown as MotifyGeneration],
        });

        await harness.graph.invoke(input('Make the headline larger.'));

        expect(harness.repository.overwriteForGraph).toHaveBeenCalledWith('proj_1', expect.objectContaining({
            inputTokens: 1_200,
            outputTokens: 340,
        }));
    });

    it('records the user message once for a generation request', async () => {
        const harness = createHarness({ intent: 'EDIT' });

        await harness.graph.invoke(input('Make the headline larger.'));

        expect(harness.repository.appendMessage).toHaveBeenCalledTimes(1);
        expect(harness.repository.appendMessage).toHaveBeenCalledWith({
            projectId: 'proj_1',
            userId: 'user_1',
            role: 'user',
            content: 'Make the headline larger.',
            intent: 'EDIT',
        });
    });

    it('sends only model-selected optional skills and current project source to the model', async () => {
        const harness = createHarness({
            intent: 'EDIT',
            selectedSkillIds: ['scene-components', 'technical-data'],
        });
        const bundle = await loadSkillBundle();
        const expected = bundle.skills.filter((skill) => [
            'runtime-contract',
            'write-motify',
            'scene-components',
            'technical-data',
        ].includes(skill.id));

        const result = await harness.graph.invoke(input('Make the title typography larger and retime the timeline duration.'));

        expect(result.selectedSkills?.map((skill) => skill.id)).toEqual(expected.map((skill) => skill.id));
        for (const skill of expected) {
            const body = skill.content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
            expect(harness.generateRequests[0]?.systemInstructions).toContain(body);
        }
        expect(result.selectedSkills?.map((skill) => skill.id)).toContain('technical-data');
        expect(harness.generateRequests[0]?.systemInstructions).toContain('Technical data product film');
        const selectedSkills = result.selectedSkills ?? [];
        expect(harness.onSkillsSelected).toHaveBeenCalledOnce();
        expect(harness.onSkillsSelected).toHaveBeenCalledWith({
            intent: 'EDIT',
            manifestVersion: bundle.manifest.version,
            skills: selectedSkills.map(({ id, reason }) => ({ id, reason })),
            totalCharacters: selectedSkills.reduce(
                (total, skill) => total + skill.content.length,
                0,
            ),
        });
        expect(harness.generateRequests[0]?.prompt).toContain(currentProject.compositionHtml);
        expect(harness.generateRequests[0]?.prompt).toContain('Make the title typography larger and retime the timeline duration.');
    });

    it('wraps a terse generation request in the Motify production brief', async () => {
        const harness = createHarness({ intent: 'CREATE' });

        await harness.graph.invoke(input('make a launch video'));

        const prompt = harness.generateRequests[0]?.prompt ?? '';
        expect(prompt).toContain('Motify production brief:');
        expect(prompt).toContain('Original user request:\nmake a launch video');
        expect(prompt).toContain('3-6 connected beats');
    });

    it('leaves a detailed generation request unwrapped', async () => {
        const harness = createHarness({ intent: 'CREATE' });
        const detailed = 'Create a 12 second launch film that opens on the dashboard, shows the sync friction, then reveals the automation panel.';

        await harness.graph.invoke(input(detailed));

        const prompt = harness.generateRequests[0]?.prompt ?? '';
        expect(prompt).toContain(detailed);
        expect(prompt).not.toContain('Motify production brief:');
    });

    it('routes a reported runtime error to FIX without asking the model to classify it', async () => {
        const harness = createHarness();

        const result = await harness.graph.invoke(input('It crashed.', {
            runtimeError: { message: 'Cannot read properties of null' },
            revision: 7,
        }));

        expect(harness.structured).toHaveBeenCalledTimes(1);
        expect(harness.structured).toHaveBeenCalledWith(expect.objectContaining({
            schemaName: 'motify_skill_selection',
        }));
        expect(result.intent).toBe('FIX');
        expect(harness.generateRequests[0]?.prompt).toContain('Cannot read properties of null');
        expect(result.response).toMatchObject({ type: 'generation', revision: 8 });
    });

    it('reports a revision conflict without writing when the project moved on', async () => {
        const harness = createHarness({ intent: 'EDIT' });

        const result = await harness.graph.invoke(input('Make the headline larger.', { revision: 6 }));

        expect(result.response).toEqual({
            type: 'error',
            code: 'REVISION_CONFLICT',
            message: 'The project changed since it was loaded.',
            currentRevision: 7,
        });
    });

    it('refuses generation for a viewer', async () => {
        const harness = createHarness({ intent: 'EDIT', role: 'viewer' });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.response).toEqual({
            type: 'error',
            code: 'FORBIDDEN',
            message: 'Viewer access is read-only.',
        });
        expect(harness.generateRequests).toHaveLength(0);
        expect(harness.repository.overwriteForGraph).not.toHaveBeenCalled();
    });

    it('reports a missing project without calling the generation model', async () => {
        const harness = createHarness({ intent: 'EDIT', project: null });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.response).toEqual({
            type: 'error',
            code: 'PROJECT_NOT_FOUND',
            message: 'Project not found.',
        });
        expect(harness.generateRequests).toHaveLength(0);
    });

    it('treats a FIX classification with no reported runtime error as an edit', async () => {
        const harness = createHarness({ intent: 'FIX' });

        const result = await harness.graph.invoke(input('Fix the spacing under the headline.'));

        expect(result.intent).toBe('EDIT');
        expect(harness.repository.overwriteForGraph).toHaveBeenCalledWith('proj_1', expect.objectContaining({ intent: 'EDIT' }));
    });

    it('lets a CREATE request replace the source of the addressed project', async () => {
        const harness = createHarness({
            intent: 'CREATE',
            project: { ...currentProject, compositionHtml: '<template><style></style></template>' },
        });

        const result = await harness.graph.invoke(input('Create a product launch animation.'));

        expect(harness.generateRequests[0]?.prompt).toContain('You may replace the current source completely.');
        expect(harness.repository.overwriteForGraph).toHaveBeenCalledWith('proj_1', expect.objectContaining({ intent: 'CREATE' }));
        expect(result.response).toMatchObject({ type: 'generation', revision: 8 });
    });

    it('repairs one invalid candidate with its diagnostics and then saves it', async () => {
        const harness = createHarness({ intent: 'EDIT', candidates: [invalidCandidate, validCandidate] });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.repairAttempts).toBe(1);
        expect(result.response).toMatchObject({ type: 'generation', revision: 8 });
        expect(harness.generateRequests).toHaveLength(2);
        expect(harness.generateRequests[1]?.prompt).toContain('FORBIDDEN_API');
        expect(harness.repository.overwriteForGraph).toHaveBeenCalledWith('proj_1', expect.objectContaining({
            repairAttempts: 1,
            generation: validCandidate,
        }));
    });

    it('stops after two repairs and records a failed run without overwriting the project', async () => {
        const harness = createHarness({ intent: 'EDIT', candidates: [invalidCandidate] });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.repairAttempts).toBe(2);
        expect(harness.generateRequests).toHaveLength(3);
        expect(result.response).toMatchObject({
            type: 'error',
            code: 'GENERATION_INVALID',
            errors: expect.arrayContaining([expect.objectContaining({ code: 'FORBIDDEN_API' })]),
        });
        expect(harness.repository.overwriteForGraph).not.toHaveBeenCalled();
        expect(harness.repository.recordRun).toHaveBeenCalledWith(expect.objectContaining({
            projectId: 'proj_1',
            baseRevision: 7,
            savedRevision: null,
            intent: 'EDIT',
            model: 'fake-model',
            repairAttempts: 2,
            status: 'FAILED',
        }));
    });

    it('creates a project in the addressed workspace when no project is addressed', async () => {
        const harness = createHarness({ intent: 'CREATE' });

        const result = await harness.graph.invoke(workspaceInput('Make me a launch animation.'));

        expect(result.intent).toBe('CREATE');
        expect(harness.repository.loadForGraph).not.toHaveBeenCalled();
        expect(harness.repository.createForGraph).toHaveBeenCalledWith('ws_1', 'user_1', expect.objectContaining({
            generation: validCandidate,
            repairAttempts: 0,
            model: 'fake-model',
        }));
        expect(result.response).toEqual({
            type: 'generation',
            message: 'Made the headline larger.',
            projectId: 'proj_new',
            revision: 1,
            created: true,
        });
    });

    it('refuses to create a project when the workspace denies writes', async () => {
        const harness = createHarness({ intent: 'CREATE', canCreate: false });

        const result = await harness.graph.invoke(workspaceInput('Make me a launch animation.'));

        expect(result.response).toEqual({
            type: 'error',
            code: 'FORBIDDEN',
            message: 'Viewer access is read-only.',
        });
    });

    it('refuses a project that belongs to another workspace', async () => {
        const harness = createHarness({ intent: 'EDIT', project: { ...currentProject, workspaceId: 'ws_other' } });

        const result = await harness.graph.invoke(input('Make the headline larger.'));

        expect(result.response).toEqual({
            type: 'error',
            code: 'PROJECT_NOT_FOUND',
            message: 'Project not found.',
        });
        expect(harness.generateRequests).toHaveLength(0);
    });

    it('records no run for a failed create because no project row exists', async () => {
        const harness = createHarness({ intent: 'CREATE', candidates: [invalidCandidate] });

        const result = await harness.graph.invoke(workspaceInput('Make me a launch animation.'));

        expect(result.response).toMatchObject({ type: 'error', code: 'GENERATION_INVALID' });
        expect(harness.repository.recordRun).not.toHaveBeenCalled();
        expect(harness.repository.createForGraph).not.toHaveBeenCalled();
    });
});
