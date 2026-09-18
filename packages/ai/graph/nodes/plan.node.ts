import { CONVERSATION_LIMITS, PLAN_SYSTEM_PROMPT } from '../../prompts/router.prompt.js';
import type { ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Returns a text plan only. It never selects generation skills, produces source,
 * validates a candidate, writes project state, or records a generation run.
 */
export function createPlanNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => ({
        response: {
            type: 'plan',
            message: await dependencies.provider.chat({
                model: dependencies.model,
                systemInstructions: PLAN_SYSTEM_PROMPT,
                messages: [...state.recentMessages, { role: 'user', content: state.message }],
                limits: CONVERSATION_LIMITS,
                images: state.assets,
            }),
        },
    });
}
