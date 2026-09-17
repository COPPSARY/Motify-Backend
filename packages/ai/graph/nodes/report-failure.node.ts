import { requireGenerationIntent, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Ends a generation that never validated. It records a failed run for debugging and
 * returns the diagnostics without writing any candidate data to the project. A failed
 * first generation has no project row to attach the run to, so nothing is recorded.
 */
export function createReportFailureNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        if (state.projectId) {
            await dependencies.repository.recordRun({
                projectId: state.projectId,
                baseRevision: state.revision ?? state.project?.revision ?? 0,
                savedRevision: null,
                intent: requireGenerationIntent(state.intent),
                model: dependencies.model,
                selectedSkills: state.selectedSkills.map((skill) => skill.id),
                repairAttempts: state.repairAttempts,
                status: 'FAILED',
                latencyMs: dependencies.now() - state.startedAtMs,
                inputTokens: state.tokenUsage.inputTokens,
                outputTokens: state.tokenUsage.outputTokens,
            });
        }

        return {
            response: {
                type: 'error',
                code: 'GENERATION_INVALID',
                message: 'Motify could not produce a valid composition for that request.',
                errors: state.validationErrors,
            },
        };
    };
}
