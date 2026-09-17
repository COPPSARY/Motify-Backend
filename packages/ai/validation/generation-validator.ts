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
}

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlTemplate = DefaultTreeAdapterMap['template'];

const forbiddenApiPattern = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage)\b|document\s*\.\s*cookie|window\s*\.\s*open|createElement\s*\(\s*['"]script['"]\s*\)/;

export function validateMotifyGeneration(generation: MotifyGeneration): ValidationReport {
    const errors: ValidationError[] = [];
    validateHtml(generation.compositionHtml, errors);
    validateTimeline(generation.timelineJs, errors);
    return { valid: errors.length === 0, errors };
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
