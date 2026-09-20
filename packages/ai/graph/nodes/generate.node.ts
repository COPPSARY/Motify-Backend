import { enhanceMotifyPrompt, needsEnhancement } from '../../../motify-skills/prompt-enhancer.js';
import { buildMotionSystemPrompt, buildMotionUserPrompt, GENERATION_LIMITS } from '../../prompts/motion.prompt.js';
import { requireGenerationIntent, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Produces one schema-constrained candidate from the request, the current project
 * source, bounded history, and the selected skills. A request too terse to imply
 * a structure is wrapped in the Motify production brief first; `state.message`
 * itself is left alone so history and skill routing keep the user's own wording.
 */
export function createGenerateNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const intent = requireGenerationIntent(state.intent);
        const message = needsEnhancement(state.message)
            ? enhanceMotifyPrompt(state.message, intent === 'CREATE' ? 'CREATE' : 'EDIT')
            : state.message;

        const result = await dependencies.provider.generate({
                model: dependencies.model,
                systemInstructions: buildMotionSystemPrompt(state.selectedSkills),
                prompt: buildMotionUserPrompt({
                    intent,
                    message,
                    project: state.project,
                    recentMessages: state.recentMessages,
                    runtimeError: state.runtimeError,
                    brief: state.brief,
                    reference: state.reference,
                    referenceImages: state.referenceImages,
                }),
                images: state.referenceImages,
                limits: GENERATION_LIMITS,
        });
        return { generation: result.generation, tokenUsage: result.usage };
    };
}
