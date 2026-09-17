import { buildIntentPrompt, INTENT_LIMITS, INTENT_SYSTEM_PROMPT } from '../../prompts/router.prompt.js';
import { intentSchema, type Intent } from '../../schemas/intent.schema.js';
import type { ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Keeps ordinary conversation away from expensive generation. A renderer error
 * reported by the frontend selects `FIX` without spending a model call; every
 * other message is classified by the configured model.
 */
export function createClassifyIntentNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const startedAtMs = dependencies.now();
        if (state.runtimeError) return { startedAtMs, intent: 'FIX' };
        const classified = await dependencies.provider.structured({
            model: dependencies.model,
            systemInstructions: INTENT_SYSTEM_PROMPT,
            prompt: buildIntentPrompt(state.message),
            schemaName: 'motionly_intent',
            schema: intentSchema,
            limits: INTENT_LIMITS,
        });

        return { startedAtMs, intent: normalizeIntent(classified.intent, state) };
    };
}

function normalizeIntent(intent: Intent, state: MotionGraphState): Intent {
    if (intent === 'CHAT' || intent === 'PLAN') return intent;
    if (!state.projectId) return 'CREATE';
    return intent === 'FIX' ? 'EDIT' : intent;
}
