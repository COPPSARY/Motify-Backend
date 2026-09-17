import { describe, expect, it } from 'vitest';

import { validateMotifyGeneration } from '../../../../packages/ai/validation/generation-validator.js';

const validGeneration = {
    title: 'Launch',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [],
    compositionHtml: '<template><style>.title { color: white; }</style><main data-edit="title">Launch</main></template>',
    timelineJs: 'export function buildTimeline() { return []; }',
    reply: 'Created the launch animation.',
};

describe('validateMotifyGeneration', () => {
    it('rejects network APIs and duplicated data-edit identifiers', () => {
        const report = validateMotifyGeneration({
            ...validGeneration,
            compositionHtml: '<template><style>.title { color: white; }</style><main data-edit="title"></main><p data-edit="title"></p></template>',
            timelineJs: 'export function buildTimeline() { fetch("https://example.test"); }',
        });

        expect(report.valid).toBe(false);
        expect(report.errors.map((error) => error.code)).toEqual(
            expect.arrayContaining(['DUPLICATE_EDIT_ID', 'FORBIDDEN_API']),
        );
    });
});
