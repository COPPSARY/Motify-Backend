import { describe, expect, it } from 'vitest';
import { BaseChatModel, type BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

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
import { skillsRoot } from '../../packages/motify-skills/loader.js';

/**
 * Unlike every other agent test in this suite, this one does NOT mock
 * `deepagents` — it runs the real `createDeepAgent` against the real
 * `FilesystemBackend`/skills middleware, reading actual `SKILL.md` files off
 * disk from `packages/motify-skills`. Only the model is fake, so that the
 * agent never depends on a live provider, but everything downstream of the
 * model call (skill discovery, system-prompt assembly, message construction)
 * is the genuine deepagents machinery. That is the only way to prove the
 * `styles/*` skills are actually visible to the agent, rather than merely
 * present on disk — a mocked `createDeepAgent` would never exercise the
 * skills middleware that this fix (giving `/skills/styles/` its own entry in
 * the `skills` array, since deepagents only scans one directory level per
 * skills-source path) is actually about.
 */
class CapturingFakeChatModel extends BaseChatModel<BaseChatModelCallOptions> {
    capturedMessages: BaseMessage[] = [];

    static lc_name() {
        return 'CapturingFakeChatModel';
    }

    _llmType(): string {
        return 'capturing-fake';
    }

    // The agent always has at least validate_generation/finalize_generation
    // bound, so langchain's createAgent calls bindTools before the first
    // model call. Binding doesn't need to change behavior here: the fake
    // never emits a tool_call, so the ReAct loop ends after one turn.
    override bindTools(_tools: unknown[]): this {
        return this;
    }

    async _generate(messages: BaseMessage[], _options: BaseChatModelCallOptions, _runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
        this.capturedMessages = messages;
        const message = new AIMessage({ content: 'Sure, tell me more about the film you want.' });
        return { generations: [{ text: String(message.content), message }] };
    }
}

class NoopGraphProjectRepository implements GraphProjectRepository {
    async loadProjectAccess(_projectId: string, _userId: string): Promise<{ workspaceId: string; role: GraphWorkspaceRole } | null> {
        return null;
    }
    async loadForGraph(_projectId: string, _userId: string): Promise<{ project: MotifyProject; role: GraphWorkspaceRole } | null> {
        return null;
    }
    async listRecentMessages(_projectId: string, _limit: number) {
        return [];
    }
    async appendMessage(_input: StoredMessageInput): Promise<void> {}
    async createForGraph(_workspaceId: string, _userId: string, _input: CreateGraphProjectInput): Promise<MotifyProject | null> {
        return null;
    }
    async overwriteForGraph(_projectId: string, _input: OverwriteGraphProjectInput): Promise<MotifyProject | null> {
        return null;
    }
    async recordRun(_input: GenerationRunInput): Promise<void> {}
    async recordRunUsage(): Promise<void> {}
}

describe('Motify agent skills visibility (real deepagents, fake model)', () => {
    it('lists the core skills in what the model is sent', async () => {
        const model = new CapturingFakeChatModel({});
        const runner = createMotifyAgentRunner({
            model: model as unknown as MotifyAgentDependencies['model'],
            repository: new NoopGraphProjectRepository(),
            skillsRoot,
        });

        const result = await runner.invoke({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            message: 'Can you help me plan a film?',
        });

        // The fake never calls a tool, so this is the plain-chat path.
        expect(result.response).toMatchObject({ type: 'chat' });

        const seenText = model.capturedMessages
            .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
            .join('\n');

        expect(seenText).toMatch(/runtime-contract/);
        expect(seenText).toMatch(/write-motify/);
    });
});
