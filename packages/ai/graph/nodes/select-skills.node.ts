import { routeSkills } from '../../../motify-skills/router.js';
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
        const referenceImages = (state.assets ?? []).filter((asset) => asset.role === 'reference');
        const bundle = await dependencies.loadSkills();
        const selection = await dependencies.provider.structured({
            model: dependencies.model,
            systemInstructions: SKILL_SELECTION_SYSTEM_PROMPT,
            prompt: buildSkillSelectionPrompt({
                message: state.message,
                project: state.project,
                recentMessages: state.recentMessages ?? [],
                references: referenceImages,
            }),
            schemaName: 'motify_skill_selection',
            schema: skillSelectionSchema,
            limits: SKILL_SELECTION_LIMITS,
            images: referenceImages,
        });
        const selectedSkills = routeSkills(bundle, selection.skillIds);
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
