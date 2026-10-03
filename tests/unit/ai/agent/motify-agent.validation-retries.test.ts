import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import type { MotifyGeneration } from '../../../../packages/ai/agent/generation-schema.js';
import { project, repository, runnerFor, ScriptedModel, send } from './memory-harness.js';

const metadata = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    reply: 'Saved it.',
};
const GOOD = { compositionHtml: '<template><style>.g{color:green}</style><div class="g" data-edit="e1"></div></template>', timelineJs: 'export function buildTimeline() { return { g: 1 }; }' };
const BAD = { ...GOOD, timelineJs: 'export function buildTimeline() { fetch("/x"); }' };

const call = (name: string, args: object, id: string) => new AIMessage({ content: '', tool_calls: [{ id, name, args }] });
const finalize = (film: object, id: string) => call('finalize_generation', { ...metadata, ...film }, id);
const validate = (film: object, id: string) => call('validate_generation', { ...metadata, ...film }, id);

function savingRepo() {
    const { repo, appended } = repository({ p1: project('p1') });
    const saved: MotifyGeneration[] = [];
    repo.overwriteForGraph = vi.fn(async (_id, input) => { saved.push(input.generation); return project('p1', 2); });
    return { repo, appended, saved };
}

describe('retries when the film fails validation', () => {
    it('stops after the first attempt plus two retries, saves nothing, and reports the errors', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([finalize(BAD, 'f1'), finalize(BAD, 'f2'), finalize(BAD, 'f3'), finalize(GOOD, 'f4'), new AIMessage('done')]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(model.calls).toBe(3);
        expect(saved).toEqual([]);
        expect(result.response).toMatchObject({ type: 'error', code: 'GENERATION_INVALID' });
        expect(JSON.stringify(result.response)).toContain('FORBIDDEN_API');
    });

    it('still saves when the film becomes valid on the second retry', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([finalize(BAD, 'f1'), finalize(BAD, 'f2'), finalize(GOOD, 'f3')]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(model.calls).toBe(4);
        expect(saved).toHaveLength(1);
        expect(result.response).toMatchObject({ type: 'generation', revision: 2 });
    });

    it('counts validate_generation failures too, not only finalize', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([validate(BAD, 'v1'), validate(BAD, 'v2'), finalize(BAD, 'f3'), finalize(GOOD, 'f4')]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(model.calls).toBe(3);
        expect(saved).toEqual([]);
        expect(result.response).toMatchObject({ type: 'error', code: 'GENERATION_INVALID' });
    });

    it('does not count validation that passes', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([validate(GOOD, 'v1'), validate(GOOD, 'v2'), validate(GOOD, 'v3'), validate(GOOD, 'v4'), finalize(GOOD, 'f5')]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(model.calls).toBe(6);
        expect(saved).toHaveLength(1);
        expect(result.response).toMatchObject({ type: 'generation' });
    });

    it('uses the configured number of retries', async () => {
        const none = savingRepo();
        const noRetries = new ScriptedModel([finalize(BAD, 'f1'), finalize(GOOD, 'f2')]);
        await send(runnerFor(noRetries, none.repo, { maxValidationRetries: 0 }), 'p1', 'make it');
        expect(noRetries.calls).toBe(1);
        expect(none.saved).toEqual([]);

        const four = savingRepo();
        const fourRetries = new ScriptedModel([finalize(BAD, 'a'), finalize(BAD, 'b'), finalize(BAD, 'c'), finalize(BAD, 'd'), finalize(GOOD, 'e')]);
        await send(runnerFor(fourRetries, four.repo, { maxValidationRetries: 4 }), 'p1', 'make it');
        expect(fourRetries.calls).toBe(6);
        expect(four.saved).toHaveLength(1);
    });

    it('does not cut a run short once the film is already saved', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([
            finalize(GOOD, 'f1'),
            validate(BAD, 'v2'), validate(BAD, 'v3'), validate(BAD, 'v4'),
            new AIMessage('done'),
        ]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toHaveLength(1);
        expect(result.response).toMatchObject({ type: 'generation', revision: 2 });
    });

    it('records the run as failed', async () => {
        const { repo } = savingRepo();
        const model = new ScriptedModel([finalize(BAD, 'f1'), finalize(BAD, 'f2'), finalize(BAD, 'f3')]);

        await send(runnerFor(model, repo), 'p1', 'make it');

        expect(repo.recordRun).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', status: 'FAILED' }));
    });

});
