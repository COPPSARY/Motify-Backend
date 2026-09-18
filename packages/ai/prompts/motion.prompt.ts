import type { RoutedSkill } from '../../motify-skills/router.js';
import type { GenerationIntent, MotifyProject } from '../graph/dependencies.js';
import type { ChatMessage, ModelImageInput, ModelRequestLimits } from '../providers/model.provider.js';

export const GENERATION_LIMITS: ModelRequestLimits = { maxOutputTokens: 32_000 };

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
        [
            'USER-FACING REPLY CONTRACT',
            'The `reply` field must contain 2 or 3 short plain sentences.',
            'Briefly confirm completion and summarize only the visible creative result relevant to the request.',
            'Do not include direction notes, validation commentary, scene or object counts, timestamps, prompt instructions, code, skills, or internal process.',
        ].join('\n'),
        ...sections,
    ].join('\n\n');
}

export interface MotionPromptInput {
    intent: GenerationIntent;
    message: string;
    project?: MotifyProject | undefined;
    recentMessages: ChatMessage[];
    runtimeError?: { message: string } | undefined;
    assets?: readonly ModelImageInput[] | undefined;
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

    sections.push(...describeImages(input.assets ?? []));

    sections.push(input.project ? describeProject(input.project) : NO_PROJECT_YET);
    return sections.join('\n\n');
}

/** Assets are placed in the video; references are read for layout and style only. */
export function describeImages(assets: readonly ModelImageInput[]): string[] {
    const placeable = assets.filter((asset) => asset.role === 'asset').map((asset) => (
        `- ${asset.fileName} (${asset.mediaType}); required HTML source: motify-asset://${asset.assetId}`
    ));
    const references = assets.filter((asset) => asset.role === 'reference').map((asset) => `- ${asset.fileName} (${asset.mediaType})`);
    return [
        [
            'IMAGES TO PLACE',
            placeable.length > 0
                ? `${placeable.join('\n')}\nUse every exact token above in a visible image source.`
                : 'No images to place.',
        ].join('\n'),
        [
            'REFERENCE IMAGES (read these; never put them on screen)',
            references.length > 0
                ? `${references.join('\n')}\nThese images guide layout and style only. Never embed them in the composition.`
                : 'No reference images supplied.',
        ].join('\n'),
    ];
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
