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

    it('requires placeable asset tokens in visible sources and rejects unknown tokens', () => {
        const required = 'motify-asset://11111111-1111-4111-8111-111111111111';
        const unknown = 'motify-asset://22222222-2222-4222-8222-222222222222';
        const report = validateMotifyGeneration({
            ...validGeneration,
            compositionHtml: `<template><style>.title { color: white; }</style><img src="${unknown}" /></template>`,
        }, { requiredAssetTokens: [required] });

        expect(report.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
            'REQUIRED_ASSET_MISSING',
            'UNKNOWN_ASSET_TOKEN',
        ]));
    });
});
