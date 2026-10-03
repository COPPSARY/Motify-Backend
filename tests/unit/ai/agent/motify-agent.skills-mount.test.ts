import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { project, repository, runnerFor, ScriptedModel, send } from './memory-harness.js';

const readFileCall = (file_path: string) =>
    new AIMessage({ content: '', tool_calls: [{ id: 'r1', name: 'read_file', args: { file_path, limit: 4 } }] });

async function toolReplyFor(file_path: string): Promise<string> {
    const { repo } = repository({ p1: project('p1') });
    const model = new ScriptedModel([readFileCall(file_path), new AIMessage('done')]);

    await send(runnerFor(model, repo), 'p1', 'look it up');

    return JSON.stringify(model.seen.at(-1));
}

describe('the /skills/ mount', () => {
    it('lets the agent read a skill\'s supporting file', async () => {
        const reply = await toolReplyFor('/skills/gsap-core/SKILL.md');

        expect(reply).toContain('name: gsap-core');
    });

    it('lets the agent read an example film', async () => {
        const reply = await toolReplyFor('/skills/scene-components/SKILL.md');

        expect(reply).not.toMatch(/no such file|ENOENT|not found/i);
    });
});
