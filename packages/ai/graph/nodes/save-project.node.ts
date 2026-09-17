import {
    requireCandidate,
    requireGenerationIntent,
    type MotifyProject,
    type ResolvedMotionGraphDependencies,
} from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Persists a validated candidate. An addressed project is overwritten in one atomic,
 * revision-checked write; a workspace-only request creates the project instead.
 * Nothing is written before the candidate validates.
 */
export function createSaveProjectNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const generation = requireCandidate(state.generation);
        const intent = requireGenerationIntent(state.intent);
        const selectedSkills = state.selectedSkills.map((skill) => skill.id);
        const latencyMs = dependencies.now() - state.startedAtMs;

        if (!state.projectId) {
            const created = await dependencies.repository.createForGraph(state.workspaceId, state.userId, {
                message: state.message,
                generation,
                model: dependencies.model,
                selectedSkills,
                repairAttempts: state.repairAttempts,
                latencyMs,
                inputTokens: state.tokenUsage.inputTokens,
                outputTokens: state.tokenUsage.outputTokens,
            });
            if (!created) {
                return { response: { type: 'error', code: 'FORBIDDEN', message: 'Viewer access is read-only.' } };
            }
            return saved(created, generation.reply, true);
        }

        const project = state.project;
        const overwritten = await dependencies.repository.overwriteForGraph(state.projectId, {
            userId: state.userId,
            expectedRevision: state.revision ?? project?.revision ?? 0,
            intent,
            generation,
            model: dependencies.model,
            selectedSkills,
            repairAttempts: state.repairAttempts,
            latencyMs,
            inputTokens: state.tokenUsage.inputTokens,
            outputTokens: state.tokenUsage.outputTokens,
        });

        if (!overwritten) {
            const current = await dependencies.repository.loadForGraph(state.projectId, state.userId);
            return {
                response: {
                    type: 'error',
                    code: 'REVISION_CONFLICT',
                    message: 'The project changed since it was loaded.',
                    currentRevision: current?.project.revision ?? project?.revision ?? 0,
                },
            };
        }

        return saved(overwritten, generation.reply, false);
    };
}

function saved(project: MotifyProject, message: string, created: boolean): MotionGraphUpdate {
    return {
        savedRevision: project.revision,
        response: { type: 'generation', message, projectId: project.id, revision: project.revision, created },
    };
}
