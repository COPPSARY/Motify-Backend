import type { ModelRequestLimits } from '../providers/model.provider.js';

export const SKILL_SELECTION_LIMITS: ModelRequestLimits = { maxOutputTokens: 160 };

export const SKILL_SELECTION_SYSTEM_PROMPT = [
    'Select only the optional Motionly skills that materially help create the requested film.',
    'The runtime contract and write-motionly contract are always provided separately.',
    'Choose scene-design for a deliberate multi-beat visual story; scene-components for recognisable UI, devices, charts, or product surfaces; preset-reference for a named Motionly-style motion reference; house-style for measured premium Motionly motion.',
    'Choose at most one visual direction: editorial-brutalist, playful-learning, apple-glass, technical-data, or cinematic-brand. Omit a visual direction when the prompt does not establish one.',
    'Choose no more than five optional skills. Do not choose skills merely because they exist. Return only the schema result.',
].join('\n');

export function buildSkillSelectionPrompt(message: string): string {
    return `Choose optional skills for this Motionly generation request:\n${message}`;
}
