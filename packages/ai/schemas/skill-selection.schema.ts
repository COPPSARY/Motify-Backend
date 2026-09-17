import { z } from 'zod';

export const OPTIONAL_GENERATION_SKILL_IDS = [
    'scene-design',
    'scene-components',
    'preset-reference',
    'house-style',
    'editorial-brutalist',
    'playful-learning',
    'apple-glass',
    'technical-data',
    'cinematic-brand',
] as const;

export const MAX_OPTIONAL_SKILL_SELECTION = 5;

export const skillSelectionSchema = z.strictObject({
    skillIds: z.array(z.enum(OPTIONAL_GENERATION_SKILL_IDS)).max(MAX_OPTIONAL_SKILL_SELECTION),
});

export type SkillSelection = z.infer<typeof skillSelectionSchema>;
