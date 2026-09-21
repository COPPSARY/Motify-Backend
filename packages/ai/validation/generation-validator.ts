import { transformSync } from 'esbuild';
import { parse } from 'acorn';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

import type { MotifyGeneration } from '../providers/model.provider.js';

export interface ValidationError {
    code: string;
    message: string;
    field: 'compositionHtml' | 'timelineJs' | 'generation';
}

export interface ValidationReport {
    valid: boolean;
    errors: ValidationError[];
    /**
     * Defects that make a film worse rather than broken. They are fed back to
     * repair like an error, but a candidate still carrying them after the last
     * attempt ships anyway - a dull film beats no film.
     */
    warnings: ValidationError[];
}

export interface GenerationValidationOptions {
    requiredAssetTokens?: readonly string[];
    requiredAudioTokens?: readonly string[];
}

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlTemplate = DefaultTreeAdapterMap['template'];

const forbiddenApiPattern = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage)\b|document\s*\.\s*cookie|window\s*\.\s*open|createElement\s*\(\s*['"]script['"]\s*\)/;

export function validateMotifyGeneration(
    generation: MotifyGeneration,
    options: GenerationValidationOptions = {},
): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    validateHtml(generation.compositionHtml, errors);
    validateTimeline(generation.timelineJs, errors);
    validateAssetTokens(generation.compositionHtml, options.requiredAssetTokens ?? [], errors);
    validateAudioTokens(generation.compositionHtml, options.requiredAudioTokens ?? [], errors);
    validateStyleSystem(generation.compositionHtml, warnings);
    validateMotionVocabulary(generation.timelineJs, warnings);
    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Sampled films declared a class-based design system and then inline-styled
 * everything, leaving 42 of 43 class names with no rule behind them. A token
 * style element satisfied STYLE_REQUIRED while the composition had no design
 * system at all, so what is checked is whether the classes resolve.
 */
function validateStyleSystem(html: string, warnings: ValidationError[]): void {
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
    if (undeclared.length === 0) return;
    add(
        warnings,
        'UNDEFINED_CLASS',
        `${undeclared.length} class name(s) have no rule in the embedded style: ${undeclared.slice(0, 8).join(', ')}. Style the composition through that stylesheet instead of inline attributes.`,
        'compositionHtml',
    );
}

/**
 * The runtime supplies a tuned ease vocabulary and a preset library, and the
 * skill says the quality pass scores a film on whether it used them. Sampled
 * films called no preset at all and reached for gsap's stock curves, whose
 * dynamic range reads as constant velocity over a multi-second travel.
 */
const MOTION_PRESET_CALL = /\b(?:reveal|slide|scalePop|blurReveal|maskWipe|staggerEntrance|staggerExit|cameraPush|cameraPull|sceneHandoff|morph|splitText|textReveal|editorialTextReveal|wordSlideRotate|charSpringBounce|continuousTextGradient|gradientSweep|ambientWaves)\s*\(/;
const STOCK_EASE = /ease\s*:\s*["'](power[0-4]|sine|expo|circ|back|elastic|bounce|none|linear)[^"']*["']/g;

function validateMotionVocabulary(source: string, warnings: ValidationError[]): void {
    if (!/\bEASE\s*\./.test(source)) {
        add(warnings, 'EASE_VOCABULARY_UNUSED', 'timelineJs uses none of the runtime EASE curves. Pick eases from EASE rather than gsap stock curves.', 'timelineJs');
    }
    if (!MOTION_PRESET_CALL.test(source)) {
        add(warnings, 'MOTION_PRESETS_UNUSED', 'timelineJs calls no motion preset. Build entrances, handoffs and text reveals from the preset library instead of raw tweens.', 'timelineJs');
    }
    const stock = [...source.matchAll(STOCK_EASE)].map((match) => match[1]);
    if (stock.length === 0) return;
    add(
        warnings,
        'STOCK_EASE',
        `${stock.length} tween(s) use gsap stock easing (${[...new Set(stock)].slice(0, 5).join(', ')}). Use the EASE vocabulary so motion carries the house velocity profile.`,
        'timelineJs',
    );
}

function validateAssetTokens(html: string, required: readonly string[], errors: ValidationError[]): void {
    const allowed = new Set(required);
    const tokens = new Set(html.match(/motify-asset:\/\/[0-9a-f-]{36}/gi) ?? []);
    for (const token of required) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const visible = new RegExp(`(?:src\\s*=\\s*["']${escaped}["']|url\\(\\s*["']?${escaped}["']?\\s*\\))`, 'i').test(html);
        if (!visible) add(errors, 'REQUIRED_ASSET_MISSING', `Required asset '${token}' is not used in a visible source.`, 'compositionHtml');
    }
    for (const token of tokens) {
        if (!allowed.has(token)) add(errors, 'UNKNOWN_ASSET_TOKEN', `Unknown Motify asset token '${token}'.`, 'compositionHtml');
    }
}

/** Every supplied track must be an audio element's source; no other audio token may appear. */
function validateAudioTokens(html: string, required: readonly string[], errors: ValidationError[]): void {
    const allowed = new Set(required);
    const sources = new Set<string>();
    visit(parseFragment(html), (node) => {
        if (!isElement(node, 'audio')) return;
        const source = node.attrs.find((attribute) => attribute.name === 'src')?.value.trim();
        if (source) sources.add(source);
    });
    for (const token of required) {
        if (!sources.has(token)) add(errors, 'REQUIRED_AUDIO_MISSING', `Required audio '${token}' is not the source of an <audio> element.`, 'compositionHtml');
    }
    for (const token of new Set(html.match(/motify-audio:\/\/[0-9a-f-]{36}/gi) ?? [])) {
        if (!allowed.has(token)) add(errors, 'UNKNOWN_AUDIO_TOKEN', `Unknown Motify audio token '${token}'.`, 'compositionHtml');
    }
}

function validateHtml(html: string, errors: ValidationError[]): void {
    const fragment = parseFragment(html);
    const templates = childrenOf(fragment).filter((node): node is HtmlElement => isElement(node, 'template'));
    if (templates.length !== 1) add(errors, 'TEMPLATE_REQUIRED', 'compositionHtml must contain exactly one top-level template.', 'compositionHtml');
    const editIds = new Set<string>();
    let hasStyle = false;
    visit(fragment, (node) => {
        if (!isElement(node)) return;
        if (node.tagName === 'style') hasStyle = true;
        if (node.tagName === 'script') add(errors, 'SCRIPT_NOT_ALLOWED', 'compositionHtml cannot contain script elements.', 'compositionHtml');
        const editId = node.attrs.find((attribute) => attribute.name === 'data-edit')?.value;
        if (editId) {
            if (editIds.has(editId)) add(errors, 'DUPLICATE_EDIT_ID', `data-edit '${editId}' is duplicated.`, 'compositionHtml');
            editIds.add(editId);
        }
    });
    if (!hasStyle) add(errors, 'STYLE_REQUIRED', 'compositionHtml must embed a style element.', 'compositionHtml');
}

function validateTimeline(source: string, errors: ValidationError[]): void {
    try {
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
        const hasBuildTimeline = program.body.some((statement) => statement.type === 'ExportNamedDeclaration'
            && statement.declaration?.type === 'FunctionDeclaration'
            && statement.declaration.id?.name === 'buildTimeline');
        if (!hasBuildTimeline) add(errors, 'BUILD_TIMELINE_REQUIRED', 'timelineJs must export function buildTimeline.', 'timelineJs');
        if (program.body.some((statement) => statement.type === 'ImportDeclaration') || /\bimport\s*\(/.test(source)) {
            add(errors, 'IMPORT_NOT_ALLOWED', 'timelineJs cannot import dependencies.', 'timelineJs');
        }
    } catch {
        add(errors, 'JAVASCRIPT_PARSE_ERROR', 'timelineJs is not valid JavaScript.', 'timelineJs');
    }
    if (forbiddenApiPattern.test(source)) add(errors, 'FORBIDDEN_API', 'timelineJs uses a forbidden browser, network, or storage API.', 'timelineJs');
    try {
        transformSync(source, { loader: 'js', format: 'esm', platform: 'browser' });
    } catch {
        add(errors, 'JAVASCRIPT_SYNTAX_ERROR', 'timelineJs could not be syntax checked.', 'timelineJs');
    }
}

function isElement(node: HtmlNode, tagName?: string): node is HtmlElement {
    return 'tagName' in node && (tagName === undefined || node.tagName === tagName);
}

function childrenOf(node: HtmlNode): HtmlNode[] {
    return 'childNodes' in node ? node.childNodes : [];
}

function visit(node: HtmlNode, visitor: (node: HtmlNode) => void): void {
    visitor(node);
    for (const child of childrenOf(node)) visit(child, visitor);
    if (isTemplate(node)) visit(node.content, visitor);
}

function isTemplate(node: HtmlNode): node is HtmlTemplate {
    return isElement(node, 'template') && 'content' in node;
}

function add(errors: ValidationError[], code: string, message: string, field: ValidationError['field']): void {
    errors.push({ code, message, field });
}
