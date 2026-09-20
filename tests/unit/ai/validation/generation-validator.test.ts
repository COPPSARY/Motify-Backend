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

describe('quality warnings', () => {
    /** Warnings never make a candidate invalid; they only steer one repair. */
    it('reports classes with no rule behind them without failing the candidate', () => {
        const report = validateMotifyGeneration({
            ...validGeneration,
            compositionHtml:
                '<template><style>.word { display: inline-block; }</style>' +
                '<main class="mk-stage mk-theme-midnight" style="color: white"><h1 class="mk-hero">Go</h1></main></template>',
        });

        expect(report.valid).toBe(true);
        expect(report.errors).toEqual([]);
        const undefinedClass = report.warnings.find((warning) => warning.code === 'UNDEFINED_CLASS');
        expect(undefinedClass?.message).toContain('mk-stage');
        expect(undefinedClass?.message).toContain('mk-hero');
    });

    it('accepts a composition whose classes all resolve', () => {
        const report = validateMotifyGeneration({
            ...validGeneration,
            compositionHtml:
                '<template><style>.stage { inset: 0; } .hero { font-weight: 700; }</style>' +
                '<main class="stage"><h1 class="hero">Go</h1></main></template>',
        });

        expect(report.warnings.some((warning) => warning.code === 'UNDEFINED_CLASS')).toBe(false);
    });

    it('flags a timeline that ignores the runtime motion vocabulary', () => {
        const report = validateMotifyGeneration({
            ...validGeneration,
            timelineJs:
                'export function buildTimeline({ timeline }) {' +
                ' timeline.to(x, { opacity: 1, ease: "power3.out" });' +
                ' timeline.to(y, { x: 10, ease: "expo.out" }); }',
        });

        expect(report.valid).toBe(true);
        const codes = report.warnings.map((warning) => warning.code);
        expect(codes).toContain('EASE_VOCABULARY_UNUSED');
        expect(codes).toContain('MOTION_PRESETS_UNUSED');
        const stock = report.warnings.find((warning) => warning.code === 'STOCK_EASE');
        expect(stock?.message).toContain('power3');
        expect(stock?.message).toContain('expo');
    });

    it('stays quiet when the timeline uses EASE and a preset', () => {
        const report = validateMotifyGeneration({
            ...validGeneration,
            timelineJs:
                'export function buildTimeline({ timeline, root }) {' +
                ' textReveal(timeline, root, { at: 0 });' +
                ' timeline.to(root, { x: 10, ease: EASE.travel }); }',
        });

        expect(report.warnings).toEqual([]);
    });
});
