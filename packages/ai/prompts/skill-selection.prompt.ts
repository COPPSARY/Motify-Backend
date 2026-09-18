import type { ChatMessage, ModelImageInput, ModelRequestLimits } from '../providers/model.provider.js';
import type { MotifyProject } from '../graph/dependencies.js';

export const SKILL_SELECTION_LIMITS: ModelRequestLimits = { maxOutputTokens: 160 };

export const SKILL_SELECTION_SYSTEM_PROMPT = [
    'Select only the optional Motify skills that materially help create the requested film.',
    'The runtime contract and write-motify contract are always provided separately.',
    'Choose scene-design for a deliberate multi-beat visual story; scene-components for recognisable UI, devices, charts, or product surfaces; preset-reference when the request names a specific technique or transition (e.g. cut-the-curve, zoom-through, macro settle, kinetic anchor, pullback complete) or otherwise needs precise motion tuning, or for a named Motify-style motion reference; house-style for measured premium Motify motion.',
    'Choose at most one visual direction. Use editorial-brutalist for bold type-led work, playful-learning for friendly educational stories, apple-glass for calm iOS-like product surfaces, technical-data for dashboards, cinematic-brand for atmospheric launch films, apple-notes-workflow for capture-to-organisation and device continuity, claude-product-journey for prompt-to-result AI product interactions, kiri-voice-workflow for voice/language/audio workflows, motify-launch-film for premium prompt-to-editable-workspace launches, motionly-promo-film for founder-pain product promos, recoup-recovery-story for 3D mechanism-first state recovery, relay-handoff-story for an artefact moving through approval and delivery, and tessera-data-story for persistent records transforming from inputs to comparable outputs. Omit a visual direction when the prompt does not establish one.',
    'When an existing project is supplied, this is an edit or fix of that project, not a new film: keep its current visual direction unless the request clearly asks for a different one.',
    'Choose no more than five optional skills. Do not choose skills merely because they exist. Return only the schema result.',
].join('\n');

export interface SkillSelectionPromptInput {
    message: string;
    project?: Pick<MotifyProject, 'title' | 'scenes'> | undefined;
    recentMessages: ChatMessage[];
    references?: readonly ModelImageInput[] | undefined;
}

export function buildSkillSelectionPrompt(input: SkillSelectionPromptInput): string {
    const sections = [`Choose optional skills for this Motify generation request:\n${input.message}`];

    if (input.project) {
        sections.push([
            'Existing project (this request edits or fixes it, not a new film):',
            `title: ${input.project.title}`,
            `scenes: ${input.project.scenes.map((scene) => scene.label).join(', ')}`,
        ].join('\n'));
    }

    if (input.recentMessages.length > 0) {
        sections.push(`Recent conversation:\n${input.recentMessages.map((entry) => `${entry.role}: ${entry.content}`).join('\n')}`);
    }

    if (input.references?.length) {
        sections.push([
            'REFERENCE IMAGES (attached; read them and let their style and layout guide the skill choice; they are never placed in the film):',
            ...input.references.map((image) => `- ${image.fileName}`),
        ].join('\n'));
    }

    return sections.join('\n\n');
}
