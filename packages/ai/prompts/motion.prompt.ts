import { describeBrief } from './brief.prompt.js';
import { describeReference } from './reference.prompt.js';
import type { LoadedReference } from '../../motify-references/loader.js';
import type { MotionBrief } from '../schemas/brief.schema.js';
import type { RoutedSkill } from '../../motify-skills/router.js';
import type { GenerationIntent, MotifyProject } from '../graph/dependencies.js';
import type { ChatMessage, ModelImageInput, ModelRequestLimits } from '../providers/model.provider.js';

export const GENERATION_LIMITS: ModelRequestLimits = { maxOutputTokens: 32_000, thinking: 'auto' };

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
    reference?: LoadedReference | undefined;
    brief?: MotionBrief | undefined;
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
    if (input.reference) sections.push(describeReference(input.reference));
    if (input.brief) sections.push(describeBrief(input.brief));
    return sections.join('\n\n');
}

/**
 * Assets are placed in the video; references are read for layout and style
 * only; frames are the film itself, played back.
 *
 * The distinction between the last two is the whole point of having it. A
 * reference is something the user admires and the model is told to rebuild
 * faithfully. A frame is the candidate that just failed, mounted and rendered
 * by the editor, and telling the model to rebuild what it shows would ask it
 * to reproduce the fault. Nothing else in this service can see one: the
 * validator reads source and never executes it, so a composition can pass
 * every check and still put an object half outside the canvas.
 */
export function describeImages(assets: readonly ModelImageInput[]): string[] {
    const placeable = assets.filter((asset) => asset.role === 'asset').map((asset) => (
        `- ${asset.fileName} (${asset.mediaType}); required HTML source: motify-asset://${asset.assetId}`
    ));
    const references = assets.filter((asset) => asset.role === 'reference').map((asset) => `- ${asset.fileName} (${asset.mediaType})`);
    const frames = assets.filter((asset) => asset.role === 'frame');
    const sections = [
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
    if (frames.length > 0) {
        sections.push([
            'FRAMES OF THE FILM YOU ARE FIXING (what a viewer would see)',
            frames.map((frame) => `- ${describeMoment(frame)} (${frame.mediaType})`).join('\n'),
            'The editor mounted your composition, seeked to these moments and rendered them. This is your own output: not something to imitate, and not an asset. Never embed a frame, never reference one, and never treat what it shows as the intended design. Read them for the faults the diagnostics cannot state - an object hanging off the edge of the canvas, a stack that reads as mush, a beat with nothing worth looking at - and correct those along with the listed failures.',
        ].join('\n'));
    }
    return sections;
}

/** A frame is known by when it was taken, not by a file name nobody chose. */
function describeMoment(frame: ModelImageInput): string {
    return frame.capturedAtSeconds === undefined
        ? frame.fileName
        : `${frame.capturedAtSeconds.toFixed(2)}s`;
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
