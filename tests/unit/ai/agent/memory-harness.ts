import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { vi } from 'vitest';

import type { GraphProjectRepository, MotifyProject } from '../../../../packages/ai/agent/dependencies.js';
import { createMotifyAgentRunner } from '../../../../packages/ai/agent/motify-agent.js';

export type Step = AIMessage | { fail: number };

/** Replays scripted model replies in order; `{ fail: 429 }` throws a provider-style error. Records the messages it was shown. */
export class ScriptedModel extends BaseChatModel {
    calls = 0;
    seen: BaseMessage[][] = [];
    constructor(private readonly steps: Step[]) { super({}); }
    _llmType() { return 'scripted'; }
    override bindTools(): any { return this; }
    async _generate(messages: BaseMessage[]) {
        this.seen.push(messages);
        const step = this.steps[this.calls++] ?? new AIMessage('done');
        if (!(step instanceof AIMessage)) throw Object.assign(new Error(`${step.fail} provider failed`), { status: step.fail });
        return { generations: [{ text: '', message: step }] };
    }
}

/** A film the validator accepts, so tests that save a project go through the same gate as real ones. */
export const VALID_COMPOSITION = '<template><style>.a{color:red}</style><div class="a" data-edit="e1"></div></template>';

export const project = (id: string, revision = 1, overrides: Partial<MotifyProject> = {}): MotifyProject => ({
    id, workspaceId: 'w1', revision, title: 'T', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [], compositionHtml: VALID_COMPOSITION, timelineJs: 'export function buildTimeline() { return {}; }',
    ...overrides,
} as MotifyProject);


export function repository(projects: Record<string, MotifyProject>, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) {
    const appended: Array<{ projectId: string; content: string; role: string }> = [];
    const repo: GraphProjectRepository = {
        loadProjectAccess: vi.fn(async () => ({ workspaceId: 'w1', role: 'editor' as const })),
        loadForGraph: vi.fn(async (projectId: string) => (projects[projectId] ? { project: projects[projectId]!, role: 'editor' as const } : null)),
        listRecentMessages: vi.fn(async () => history),
        appendMessage: vi.fn(async (input) => { appended.push({ projectId: input.projectId, content: input.content, role: input.role }); }),
        createForGraph: vi.fn(async () => null),
        overwriteForGraph: vi.fn(async () => null),
        recordRun: vi.fn(async () => undefined),
        recordRunUsage: vi.fn(async () => undefined),
    };
    return { repo, appended };
}

export function runnerFor(
    model: ScriptedModel,
    repo: GraphProjectRepository,
    extra: { audioSearch?: () => Promise<never[]>; maxValidationRetries?: number; maxSteps?: number } = {},
) {
    return createMotifyAgentRunner({
        model, repository: repo, skillsRoot: 'packages/motify-skills', providerName: 'openai-compatible',
        ...(extra.audioSearch ? { audioSearch: extra.audioSearch } : {}),
        ...(extra.maxValidationRetries !== undefined ? { maxValidationRetries: extra.maxValidationRetries } : {}),
        ...(extra.maxSteps !== undefined ? { maxSteps: extra.maxSteps } : {}),
    });
}

export const humans = (messages: BaseMessage[]) => messages.filter((m) => m.getType() === 'human').map((m) => String(m.content));

export const send = (runner: ReturnType<typeof runnerFor>, projectId: string, message: string) =>
    runner.invoke({ userId: 'u1', workspaceId: 'w1', projectId, message });

export const callAudioSearch = (id: string) =>
    new AIMessage({ content: '', tool_calls: [{ id, name: 'search_audio_library', args: {} }] });
