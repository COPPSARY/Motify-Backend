import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import type { MotifyGeneration } from '../../../../packages/ai/agent/generation-schema.js';
import { project, repository, runnerFor, ScriptedModel, send, VALID_COMPOSITION } from './memory-harness.js';

const metadata = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    reply: 'Saved it.',
};
const COMPOSITION = '<template><style>.z{color:teal}</style><div class="z" data-edit="e3"></div></template>';
const TIMELINE = 'export function buildTimeline() { return {}; }';
const FASTER_TIMELINE = 'export function buildTimeline() { return { faster: true }; }';

const toolCall = (name: string, args: object, id: string) =>
    new AIMessage({ content: '', tool_calls: [{ id, name, args }] });
const writeFile = (path: string, content: string, id: string) => toolCall('write_file', { file_path: path, content }, id);

describe('finalize_generation reads the drafted files', () => {
    it('saves the files the agent wrote when the call passes only the metadata', async () => {
        const { repo } = repository({ p1: project('p1') });
        let saved: MotifyGeneration | undefined;
        repo.overwriteForGraph = vi.fn(async (_id, input) => { saved = input.generation; return project('p1', 2); });
        const model = new ScriptedModel([
            writeFile('/composition.html', COMPOSITION, 'w1'),
            writeFile('/timeline.js', TIMELINE, 'w2'),
            toolCall('finalize_generation', metadata, 'f1'),
        ]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toMatchObject({ ...metadata, compositionHtml: COMPOSITION, timelineJs: TIMELINE });
        expect(result.response).toMatchObject({ type: 'generation', projectId: 'p1', revision: 2, message: 'Saved it.' });
    });

    it('still accepts the whole film in the call, as before', async () => {
        const { repo } = repository({ p1: project('p1') });
        let saved: MotifyGeneration | undefined;
        repo.overwriteForGraph = vi.fn(async (_id, input) => { saved = input.generation; return project('p1', 2); });
        const model = new ScriptedModel([
            toolCall('finalize_generation', { ...metadata, compositionHtml: COMPOSITION, timelineJs: TIMELINE }, 'f1'),
        ]);

        await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toMatchObject({ compositionHtml: COMPOSITION, timelineJs: TIMELINE });
    });

    it('does not save, and says which file to write, when the agent deleted a draft file', async () => {
        const { repo } = repository({ p1: project('p1') });
        repo.overwriteForGraph = vi.fn(async () => project('p1', 2));
        const model = new ScriptedModel([
            toolCall('delete', { file_path: '/composition.html' }, 'd1'),
            toolCall('finalize_generation', metadata, 'f1'),
            new AIMessage('I need to write the composition first.'),
        ]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(repo.overwriteForGraph).not.toHaveBeenCalled();
        expect(result.response).toMatchObject({ type: 'chat' });
        expect(JSON.stringify(model.seen.at(-1))).toContain('/composition.html');
    });

    it('refuses to re-save the unchanged project when the agent never edited its draft', async () => {
        const { repo } = repository({ p1: project('p1') });
        repo.overwriteForGraph = vi.fn(async () => project('p1', 2));
        const model = new ScriptedModel([
            toolCall('finalize_generation', metadata, 'f1'),
            new AIMessage('Let me edit the files first.'),
        ]);

        const result = await send(runnerFor(model, repo), 'p1', 'change the colors');

        expect(repo.overwriteForGraph).not.toHaveBeenCalled();
        expect(result.response).toMatchObject({ type: 'chat' });
        expect(JSON.stringify(model.seen.at(-1))).toContain('unchanged');
    });

    it('saves unchanged files when the agent passes them explicitly', async () => {
        const unchanged = project('p1');
        const { repo } = repository({ p1: unchanged });
        repo.overwriteForGraph = vi.fn(async () => project('p1', 2));
        const model = new ScriptedModel([
            toolCall('finalize_generation', { ...metadata, compositionHtml: unchanged.compositionHtml, timelineJs: unchanged.timelineJs }, 'f1'),
        ]);

        await send(runnerFor(model, repo), 'p1', 'rename it');

        expect(repo.overwriteForGraph).toHaveBeenCalledTimes(1);
    });

    it('saves when only one of the two files was edited', async () => {
        const { repo } = repository({ p1: project('p1') });
        let saved: MotifyGeneration | undefined;
        repo.overwriteForGraph = vi.fn(async (_id, input) => { saved = input.generation; return project('p1', 2); });
        const model = new ScriptedModel([
            writeFile('/timeline.js', FASTER_TIMELINE, 'w1'),
            toolCall('finalize_generation', metadata, 'f1'),
        ]);

        await send(runnerFor(model, repo), 'p1', 'speed it up');

        expect(saved).toMatchObject({ timelineJs: FASTER_TIMELINE, compositionHtml: VALID_COMPOSITION });
    });
});
