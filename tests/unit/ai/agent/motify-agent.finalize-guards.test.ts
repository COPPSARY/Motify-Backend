import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import type { MotifyGeneration } from '../../../../packages/ai/agent/generation-schema.js';
import { project, repository, runnerFor, ScriptedModel, send } from './memory-harness.js';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const metadata = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    reply: 'Saved it.',
};
const FILM = { compositionHtml: '<template><style>.a{color:red}</style><div class="a" data-edit="e1"></div></template>', timelineJs: 'export function buildTimeline() { return { a: 1 }; }' };
const OTHER_FILM = { compositionHtml: '<template><style>.b{color:blue}</style><div class="b" data-edit="e2"></div></template>', timelineJs: 'export function buildTimeline() { return { b: 2 }; }' };

const finalize = (args: object, id: string) => new AIMessage({ content: '', tool_calls: [{ id, name: 'finalize_generation', args }] });

function savingRepo() {
    const { repo, appended } = repository({ p1: project('p1') });
    const saved: MotifyGeneration[] = [];
    repo.overwriteForGraph = vi.fn(async (_id, input) => { saved.push(input.generation); return project('p1', 2); });
    return { repo, appended, saved };
}

describe('finalize_generation refuses to save a film that fails validation', () => {
    it('does not save a film with a forbidden API, and tells the agent what is wrong', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([
            finalize({ ...metadata, ...FILM, timelineJs: 'export function buildTimeline() { fetch("/x"); }' }, 'f1'),
            new AIMessage('I will fix that.'),
        ]);

        const result = await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toEqual([]);
        expect(result.response).toMatchObject({ type: 'chat' });
        expect(JSON.stringify(model.seen.at(-1))).toContain('FORBIDDEN_API');
    });

    it('does not save a film that leaves out an attached image the user asked to place', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([finalize({ ...metadata, ...FILM }, 'f1'), new AIMessage('I will add the logo.')]);

        await runnerFor(model, repo).invoke({
            userId: 'u1', workspaceId: 'w1', projectId: 'p1', message: 'use my logo',
            assets: [{ assetId: ASSET_ID, fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGk=', role: 'asset' }],
        });

        expect(saved).toEqual([]);
        expect(JSON.stringify(model.seen.at(-1))).toContain('REQUIRED_ASSET_MISSING');
    });

    it('saves the same film once it uses the attached image', async () => {
        const { repo, saved } = savingRepo();
        const withLogo = { ...FILM, compositionHtml: `<template><style>.a{color:red}</style><div class="a" data-edit="e1"><img src="motify-asset://${ASSET_ID}"></div></template>` };
        const model = new ScriptedModel([finalize({ ...metadata, ...withLogo }, 'f1')]);

        const result = await runnerFor(model, repo).invoke({
            userId: 'u1', workspaceId: 'w1', projectId: 'p1', message: 'use my logo',
            assets: [{ assetId: ASSET_ID, fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGk=', role: 'asset' }],
        });

        expect(saved).toHaveLength(1);
        expect(result.response).toMatchObject({ type: 'generation', revision: 2 });
    });
});

describe('a repeated finalize_generation in one run', () => {
    it('says plainly that a changed film was not saved, instead of reporting success', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([
            finalize({ ...metadata, ...FILM }, 'f1'),
            finalize({ ...metadata, ...OTHER_FILM }, 'f2'),
            new AIMessage('done'),
        ]);

        await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toHaveLength(1);
        expect(saved[0]!.compositionHtml).toBe(FILM.compositionHtml);
        const secondReply = JSON.stringify(model.seen.at(-1));
        expect(secondReply).toMatch(/already saved/i);
        expect(secondReply).toMatch(/not saved/i);
    });

    it('treats an identical repeat as the same save', async () => {
        const { repo, saved } = savingRepo();
        const model = new ScriptedModel([
            finalize({ ...metadata, ...FILM }, 'f1'),
            finalize({ ...metadata, ...FILM }, 'f2'),
            new AIMessage('done'),
        ]);

        await send(runnerFor(model, repo), 'p1', 'make it');

        expect(saved).toHaveLength(1);
        expect(JSON.stringify(model.seen.at(-1))).toMatch(/status\W+saved/);
    });
});

describe('an empty reply from the model', () => {
    it('is reported as invalid output, not stored or returned as a chat answer', async () => {
        const { repo, appended } = repository({ p1: project('p1') });

        const error: any = await send(runnerFor(new ScriptedModel([new AIMessage('')]), repo), 'p1', 'hello').catch((e) => e);

        expect(error.code).toBe('PROVIDER_OUTPUT_INVALID');
        expect(appended.filter((entry) => entry.role === 'assistant')).toEqual([]);
    });

    it('lets the next attempt run again after an empty reply', async () => {
        const { repo } = repository({ p1: project('p1') });
        await send(runnerFor(new ScriptedModel([new AIMessage('')]), repo), 'p1', 'hello').catch(() => undefined);

        const retry = new ScriptedModel([new AIMessage('a real answer')]);
        const result = await send(runnerFor(retry, repo), 'p1', 'hello');

        expect(result.response).toEqual({ type: 'chat', message: 'a real answer' });
        expect(retry.calls).toBe(1);
    });
});
