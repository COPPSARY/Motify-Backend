import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scoreGeneration } from '../../../evals/quality/score.js';
import type { MotifyGeneration } from '../../../packages/ai/providers/model.provider.js';

const referenceRoot = path.resolve(import.meta.dirname, '../../../packages/motify-references');

function asGeneration(overrides: Partial<MotifyGeneration>): MotifyGeneration {
    return {
        title: 'Film',
        duration: 12,
        width: 1920,
        height: 1080,
        fps: 60,
        scenes: [
            { id: 's1', label: 'Open', start: 0, duration: 4, accent: '#fff' },
            { id: 's2', label: 'Turn', start: 4, duration: 4, accent: '#fff' },
            { id: 's3', label: 'Close', start: 8, duration: 4, accent: '#fff' },
        ],
        compositionHtml: '<template><style></style><main></main></template>',
        timelineJs: 'export function buildTimeline() {}',
        reply: 'Done.',
        ...overrides,
    };
}

/** The reference films are the standard the score is calibrated against. */
function referenceGeneration(id: string): MotifyGeneration {
    return asGeneration({
        compositionHtml: readFileSync(path.join(referenceRoot, id, 'composition.html'), 'utf8'),
        timelineJs: readFileSync(path.join(referenceRoot, id, 'timeline.js'), 'utf8'),
    });
}

describe('scoreGeneration', () => {
    it('scores every shipped reference film highly', () => {
        for (const id of ['relay', 'tessera', 'recoup']) {
            const score = scoreGeneration(referenceGeneration(id));
            expect(score.total, `${id} scored ${score.total}`).toBeGreaterThan(70);
        }
    });

    it('scores an empty shell near zero', () => {
        expect(scoreGeneration(asGeneration({})).total).toBeLessThan(15);
    });

    it('penalises a film whose classes have no rules behind them', () => {
        const resolved = scoreGeneration(asGeneration({
            compositionHtml: '<template><style>.stage { inset: 0; } .hero { color: #fff; }</style>'
                + '<main class="stage"><h1 class="hero">Go</h1></main></template>',
        }));
        const unresolved = scoreGeneration(asGeneration({
            compositionHtml: '<template><style>.word { display: block; }</style>'
                + '<main class="mk-stage" style="inset:0"><h1 class="mk-hero">Go</h1></main></template>',
        }));

        expect(resolved.total).toBeGreaterThan(unresolved.total);
    });

    it('rewards the runtime motion vocabulary over stock curves', () => {
        const house = scoreGeneration(asGeneration({
            timelineJs: 'export function buildTimeline({ timeline, root }) {'
                + ' textReveal(timeline, root, { at: 0 });'
                + ' timeline.to(root, { x: 1, ease: EASE.travel }); }',
        }));
        const stock = scoreGeneration(asGeneration({
            timelineJs: 'export function buildTimeline({ timeline, root }) {'
                + ' timeline.to(root, { x: 1, ease: "power3.out" });'
                + ' timeline.to(root, { y: 1, ease: "expo.out" }); }',
        }));

        expect(house.total).toBeGreaterThan(stock.total);
        const band = house.bands.find((entry) => entry.id === 'motion-vocabulary');
        expect(band?.detail).toContain('presets x1');
    });

    it('reports a band for every weighted dimension', () => {
        const score = scoreGeneration(referenceGeneration('relay'));
        expect(score.bands.map((band) => band.id)).toEqual([
            'material', 'style-system', 'motion-vocabulary', 'editability', 'scene-variety',
        ]);
        expect(score.bands.reduce((sum, band) => sum + band.weight, 0)).toBe(100);
    });
});
