import type { RoutedSkill } from '../../motify-skills/router.js';
import type { GenerationIntent, MotifyProject } from '../graph/dependencies.js';
import type { ChatMessage, ModelRequestLimits } from '../providers/model.provider.js';

export const GENERATION_LIMITS: ModelRequestLimits = { maxOutputTokens: 16_000 };

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

    sections.push(input.project ? describeProject(input.project) : NO_PROJECT_YET);
    return sections.join('\n\n');
}

const INTENT_INSTRUCTIONS: Record<GenerationIntent, string> = {
    CREATE: 'Build the composition the user asked for. You may replace the current source completely.',
    EDIT: 'Return the complete updated project. Change only what the user asked for and keep every other element, style, timing, and data-edit identifier intact.',
    FIX: 'Return the complete repaired project. Make the smallest change that removes the reported failure and keep the existing design intact.',
};

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
