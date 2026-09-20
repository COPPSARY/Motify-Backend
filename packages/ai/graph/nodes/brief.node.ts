import { BRIEF_LIMITS, BRIEF_SYSTEM_PROMPT, buildBriefPrompt } from '../../prompts/brief.prompt.js';
import { briefDefects, motionBriefSchema } from '../../schemas/brief.schema.js';
import type { ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Decides the film's structure before any source is written.
 *
 * Only CREATE gets a brief: an edit must preserve the structure already on
 * screen, and a fix must change as little as possible. A failed brief is not
 * fatal - generation falls back to its previous behaviour.
 */
export function createBriefNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        if (state.intent !== 'CREATE') return {};
        try {
            const brief = await dependencies.provider.structured({
                model: dependencies.model,
                systemInstructions: BRIEF_SYSTEM_PROMPT,
                prompt: buildBriefPrompt(state.message),
                schemaName: 'motify_brief',
                schema: motionBriefSchema,
                limits: BRIEF_LIMITS,
            });
            dependencies.onBrief({ beats: brief.beats.length, defects: briefDefects(brief) });
            return { brief };
        } catch {
            return {};
        }
    };
}
