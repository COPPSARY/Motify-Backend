import { FALLBACK_GENERATION_SKILL_IDS, routeSkills } from '../../../motionly-skills/router.js';
import { SKILL_SELECTION_LIMITS, SKILL_SELECTION_SYSTEM_PROMPT, buildSkillSelectionPrompt } from '../../prompts/skill-selection.prompt.js';
import { skillSelectionSchema } from '../../schemas/skill-selection.schema.js';
import { requireGenerationIntent, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Selects a manifest-constrained, request-specific bundle before generation.
 */
export function createSelectSkillsNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const intent = requireGenerationIntent(state.intent);
        const bundle = await dependencies.loadSkills();
        let selectedSkills;
        try {
            const selection = await dependencies.provider.structured({
                model: dependencies.model,
                systemInstructions: SKILL_SELECTION_SYSTEM_PROMPT,
                prompt: buildSkillSelectionPrompt(state.message),
                schemaName: 'motionly_skill_selection',
                schema: skillSelectionSchema,
                limits: SKILL_SELECTION_LIMITS,
            });
            selectedSkills = routeSkills(bundle, selection.skillIds);
        } catch {
            selectedSkills = routeSkills(bundle, FALLBACK_GENERATION_SKILL_IDS);
        }
        dependencies.onSkillsSelected({
            intent,
            manifestVersion: bundle.manifest.version,
            skills: selectedSkills.map(({ id, reason }) => ({ id, reason })),
            totalCharacters: selectedSkills.reduce(
                (total, skill) => total + skill.content.length,
                0,
            ),
        });
        return { selectedSkills };
    };
}
