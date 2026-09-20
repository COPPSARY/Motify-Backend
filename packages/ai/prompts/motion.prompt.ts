import { describeBrief } from './brief.prompt.js';
import { describeReference } from './reference.prompt.js';
import type { LoadedReference } from '../../motify-references/loader.js';
import type { RoutedSkill } from '../../motify-skills/router.js';
import type { GenerationIntent, MotifyProject } from '../graph/dependencies.js';
import type { MotionBrief } from '../schemas/brief.schema.js';
import type { PromptImage } from '../providers/model.provider.js';
import type { ChatMessage, ModelRequestLimits } from '../providers/model.provider.js';

/**
 * The output ceiling for a whole composition. Gemini's flash tiers cap at 65,536
 * output tokens and thinking counts against it, so this is the model maximum
 * rather than a tuned value: a film's HTML alone runs tens of kilobytes.
 */
export const MAX_GENERATION_OUTPUT_TOKENS = 65_536;

export const GENERATION_LIMITS: ModelRequestLimits = { maxOutputTokens: MAX_GENERATION_OUTPUT_TOKENS, thinking: 'auto' };

const FENCE = '```';
const FRONTMATTER = /^---\n[\s\S]*?\n---\n*/;

export function buildMotionSystemPrompt(skills: RoutedSkill[]): string {
    const firstSkill = skills[0];
    if (!firstSkill) throw new Error('Motify system prompt requires routed skills.');

    const sections = skills.map((skill) => [
        `SKILL: ${skill.id}`,
        skill.content.replace(FRONTMATTER, '').trim(),
    ].join('\n'));

    return [
        `MOTIFY SKILL BUNDLE VERSION: ${firstSkill.version}`,
        ...sections,
    ].join('\n\n');
}

export interface MotionPromptInput {
    intent: GenerationIntent;
    message: string;
    project?: MotifyProject | undefined;
    recentMessages: ChatMessage[];
    runtimeError?: { message: string } | undefined;
    brief?: MotionBrief | undefined;
    reference?: LoadedReference | undefined;
    referenceImages?: readonly PromptImage[] | undefined;
}

export function buildMotionUserPrompt(input: MotionPromptInput): string {
    const sections = [
        `Task: ${INTENT_INSTRUCTIONS[input.intent]}`,
        `User request:\n${input.message}`,
    ];

    if (input.runtimeError) {
        sections.push(`Renderer error reported for the current project:\n${input.runtimeError.message}`);
    }
    if (input.recentMessages.length > 0) {
        sections.push(`Recent conversation:\n${formatHistory(input.recentMessages)}`);
    }

    if (input.referenceImages?.length) sections.push(describeReferenceImages(input.referenceImages.length));
    sections.push(input.project ? describeProject(input.project) : NO_PROJECT_YET);
    if (input.reference) sections.push(describeReference(input.reference));
    if (input.brief) sections.push(describeBrief(input.brief));
    return sections.join('\n\n');
}

const INTENT_INSTRUCTIONS: Record<GenerationIntent, string> = {
    CREATE: 'Build the composition the user asked for. You may replace the current source completely.',
    EDIT: 'Return the complete updated project. Change only what the user asked for and keep every other element, style, timing, and data-edit identifier intact.',
    FIX: 'Return the complete repaired project. Make the smallest change that removes the reported failure and keep the existing design intact.',
};

/**
 * The skill already knows what a REFERENCE IMAGE is and what to do with one; it
 * only ever lacked the images. This names the block it expects.
 */
export function describeReferenceImages(count: number): string {
    return [
        `REFERENCE IMAGES (${count}) are attached to this message.`,
        'Read their layout, type, spacing, palette and product chrome, and rebuild what they show as authored HTML and SVG.',
        'They are reference only. Never place one on screen, and never invent an asset token or URL for one.',
    ].join('\n');
}

export const NO_PROJECT_YET = [
    'There is no project yet; this generation creates one.',
    'Choose a canvas that suits the request and default to 1920x1080 at 60fps when the user gives no preference.',
].join('\n');

export function describeProject(project: MotifyProject): string {
    return [
        'Current project:',
        `title: ${project.title}`,
        `canvas: ${project.width}x${project.height} at ${project.fps}fps`,
        `duration: ${project.duration}s`,
        `revision: ${project.revision}`,
        `scenes: ${JSON.stringify(project.scenes)}`,
        '',
        'Current compositionHtml:',
        `${FENCE}html\n${project.compositionHtml}\n${FENCE}`,
        '',
        'Current timelineJs:',
        `${FENCE}js\n${project.timelineJs}\n${FENCE}`,
    ].join('\n');
}

function formatHistory(messages: ChatMessage[]): string {
    return messages.map((message) => `${message.role}: ${message.content}`).join('\n');
}
