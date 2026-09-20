import { buildMotionSystemPrompt, buildMotionUserPrompt, GENERATION_LIMITS } from '../../prompts/motion.prompt.js';
import { requireGenerationIntent, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Produces one schema-constrained candidate from the request, the current project
 * source, bounded history, and the selected skills. The user request is passed
 * through unchanged; the routed skills and system prompt provide the constraints.
 */
export function createGenerateNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const intent = requireGenerationIntent(state.intent);

        const result = await dependencies.provider.generate({
                model: dependencies.model,
                systemInstructions: buildMotionSystemPrompt(state.selectedSkills),
                prompt: buildMotionUserPrompt({
                    intent,
                    message: state.message,
                    project: state.project,
                    recentMessages: state.recentMessages,
                    runtimeError: state.runtimeError,
                    assets: state.assets,
                    reference: state.reference,
                    brief: state.brief,
                }),
                limits: GENERATION_LIMITS,
                images: state.assets,
        });
        return { generation: result.generation, tokenUsage: result.usage };
    };
}
