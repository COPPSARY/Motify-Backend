import type { LoadedSkill, SkillManifest } from './loader.js';
import { OPTIONAL_GENERATION_SKILL_IDS } from '../ai/schemas/skill-selection.schema.js';

export const REQUIRED_GENERATION_SKILL_IDS = ['runtime-contract', 'write-motify'] as const;
const VISUAL_DIRECTION_SKILL_IDS = new Set([
    'editorial-brutalist',
    'playful-learning',
    'apple-glass',
    'technical-data',
    'cinematic-brand',
    'apple-notes-workflow',
    'claude-product-journey',
    'kiri-voice-workflow',
    'motify-launch-film',
    'motionly-promo-film',
    'recoup-recovery-story',
    'relay-handoff-story',
    'tessera-data-story',
]);

export interface RoutedSkill {
    id: string;
    version: string;
    reason: string;
    content: string;
}

export function routeSkills(
    bundle: { manifest: SkillManifest; skills: LoadedSkill[] },
    requestedIds: readonly string[],
): RoutedSkill[] {
    const allowed = new Set<string>([...REQUIRED_GENERATION_SKILL_IDS, ...OPTIONAL_GENERATION_SKILL_IDS]);
    let hasVisualDirection = false;
    const requested = requestedIds.filter((id) => {
        if (!allowed.has(id)) return false;
        if (!VISUAL_DIRECTION_SKILL_IDS.has(id)) return true;
        if (hasVisualDirection) return false;
        hasVisualDirection = true;
        return true;
    });
    const ids = [...new Set([...REQUIRED_GENERATION_SKILL_IDS, ...requested])];

    return ids.map((id) => {
        const skill = bundle.skills.find((candidate) => candidate.id === id);
        if (!skill) throw new Error(`Missing Motify generation skill: ${id}`);
        return toRoutedSkill(skill, bundle.manifest.version, id === 'runtime-contract' || id === 'write-motify'
            ? 'Required for generation'
            : 'Selected by AI for this request');
    });
}

function toRoutedSkill(skill: LoadedSkill, version: string, reason: string): RoutedSkill {
    return {
        id: skill.id,
        version,
        reason,
        content: skill.content,
    };
}
