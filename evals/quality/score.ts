import type { MotifyGeneration } from '../../packages/ai/providers/model.provider.js';

/**
 * A measurable stand-in for craft, not a judgement of it.
 *
 * Nothing here can tell whether a film is good. What it can tell is whether a
 * film has the properties every good one in packages/motify-references has and
 * every weak sampled generation lacked: a real stylesheet its markup actually
 * uses, the runtime motion vocabulary, editable identifiers, and enough
 * material to fill its running time. Those correlate with quality closely
 * enough to hill-climb against, and unlike a rendered frame they cost nothing.
 *
 * Targets are the floor of the three reference films, not their average, so a
 * full score means "comparable to the weakest thing we ship", not "excellent".
 */
export interface ScoreBand {
    id: string;
    weight: number;
    score: number;
    detail: string;
}

export interface QualityScore {
    total: number;
    bands: ScoreBand[];
}

/** relay is the smallest reference film; its shape sets the floor. */
const TARGET_HTML_BYTES = 10_000;
const TARGET_CSS_BYTES = 5_000;
const TARGET_TIMELINE_BYTES = 5_000;
const TARGET_EASE_USES = 15;
const TARGET_EDIT_IDS = 26;

const MOTION_PRESET_CALL = /\b(?:reveal|slide|scalePop|blurReveal|maskWipe|staggerEntrance|staggerExit|cameraPush|cameraPull|sceneHandoff|morph|splitText|textReveal|editorialTextReveal|wordSlideRotate|charSpringBounce|continuousTextGradient|gradientSweep|ambientWaves)\s*\(/g;
const STOCK_EASE = /ease\s*:\s*["'](?:power[0-4]|sine|expo|circ|back|elastic|bounce|none|linear)[^"']*["']/g;

function ratio(actual: number, target: number): number {
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, actual / target));
}

function count(source: string, pattern: RegExp): number {
    return (source.match(pattern) ?? []).length;
}

export function scoreGeneration(generation: MotifyGeneration): QualityScore {
    const html = generation.compositionHtml;
    const timeline = generation.timelineJs;
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map((match) => match[1] ?? '')
        .join('\n');

    const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));
    const used = new Set(
        [...html.matchAll(/class="([^"]*)"/g)]
            .flatMap((match) => (match[1] ?? '').split(/\s+/))
            .filter(Boolean),
    );
    const undeclared = [...used].filter((name) => !defined.has(name));
    const resolved = used.size === 0 ? 0 : 1 - undeclared.length / used.size;

    const easeUses = count(timeline, /EASE\s*\./g);
    const presetUses = count(timeline, MOTION_PRESET_CALL);
    const stockEase = count(timeline, STOCK_EASE);
    const editIds = count(html, /data-edit=/g);

    const framings = new Set(generation.scenes.map((scene) => scene.label.toLowerCase().trim()));
    const sceneVariety = generation.scenes.length === 0
        ? 0
        : framings.size / generation.scenes.length;

    const bands: ScoreBand[] = [
        {
            id: 'material',
            weight: 25,
            score: (ratio(html.length, TARGET_HTML_BYTES) + ratio(timeline.length, TARGET_TIMELINE_BYTES)) / 2,
            detail: `html ${html.length}B / timeline ${timeline.length}B`,
        },
        {
            id: 'style-system',
            weight: 25,
            score: (ratio(css.length, TARGET_CSS_BYTES) + resolved) / 2,
            detail: `css ${css.length}B, ${undeclared.length}/${used.size} classes undeclared`,
        },
        {
            id: 'motion-vocabulary',
            weight: 25,
            score: (ratio(easeUses, TARGET_EASE_USES) + (presetUses > 0 ? 1 : 0)) / 2,
            detail: `EASE x${easeUses}, presets x${presetUses}, stock ease x${stockEase}`,
        },
        {
            id: 'editability',
            weight: 15,
            score: ratio(editIds, TARGET_EDIT_IDS),
            detail: `${editIds} data-edit identifiers`,
        },
        {
            id: 'scene-variety',
            weight: 10,
            score: sceneVariety,
            detail: `${framings.size} distinct labels across ${generation.scenes.length} scenes`,
        },
    ];

    // Stock easing is a defect the house style names outright, so it is a
    // penalty rather than a missing point: a film can otherwise score well
    // while every curve in it is wrong.
    const penalty = stockEase > 0 ? Math.min(10, stockEase * 2) : 0;
    const earned = bands.reduce((sum, band) => sum + band.weight * band.score, 0);

    return { total: Math.max(0, Math.round(earned - penalty)), bands };
}
