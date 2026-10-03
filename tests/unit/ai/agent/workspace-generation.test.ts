import { describe, expect, it } from 'vitest';

import { completeGeneration } from '../../../../packages/ai/agent/workspace-generation.js';

const metadata = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    reply: 'Made it.',
};

const file = (content: unknown) => ({ content, mimeType: 'text/plain', created_at: 'x', modified_at: 'x' });

describe('completeGeneration', () => {
    it('fills the composition and timeline from the workspace files when the call omits them', () => {
        const result = completeGeneration(metadata, {
            '/composition.html': file('<template>FROM FILE</template>'),
            '/timeline.js': file('export function buildTimeline() {}'),
        });

        expect(result).toEqual({
            ok: true,
            generation: { ...metadata, compositionHtml: '<template>FROM FILE</template>', timelineJs: 'export function buildTimeline() {}' },
        });
    });

    it('prefers content passed in the call over the workspace file', () => {
        const result = completeGeneration(
            { ...metadata, compositionHtml: '<template>FROM CALL</template>' },
            { '/composition.html': file('<template>FROM FILE</template>'), '/timeline.js': file('t') },
        );

        expect(result).toMatchObject({ ok: true, generation: { compositionHtml: '<template>FROM CALL</template>', timelineJs: 't' } });
    });

    it('joins file content that is stored as lines', () => {
        const result = completeGeneration(metadata, {
            '/composition.html': file(['<template>', 'A', '</template>']),
            '/timeline.js': file('t'),
        });

        expect(result).toMatchObject({ ok: true, generation: { compositionHtml: '<template>\nA\n</template>' } });
    });

    it('names exactly which draft file is missing', () => {
        const result = completeGeneration(metadata, { '/timeline.js': file('t') });

        expect(result).toMatchObject({ ok: false, missing: ['compositionHtml'] });
        expect((result as { message: string }).message).toContain('/composition.html');
        expect((result as { message: string }).message).not.toContain('/timeline.js');
    });

    it('treats an empty or whitespace-only file as missing', () => {
        const result = completeGeneration(metadata, { '/composition.html': file('   \n'), '/timeline.js': file('') });

        expect(result).toMatchObject({ ok: false, missing: ['compositionHtml', 'timelineJs'] });
    });

    it('reports both files missing when the workspace is empty', () => {
        expect(completeGeneration(metadata, {})).toMatchObject({ ok: false, missing: ['compositionHtml', 'timelineJs'] });
    });
});
