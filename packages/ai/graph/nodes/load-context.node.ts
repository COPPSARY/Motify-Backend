import { requireGenerationIntent, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Loads the addressed project, enforces write access, and bounds the conversation
 * history the model sees. The user message is stored only once access is proven.
 *
 * A workspace-only request has no project to load; its first message is stored by
 * the repository when the new project row is created.
 */
export function createLoadContextNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        if (!state.projectId) return {};

        const loaded = await dependencies.repository.loadForGraph(state.projectId, state.userId);
        if (!loaded || loaded.project.workspaceId !== state.workspaceId) {
            return { response: { type: 'error', code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } };
        }
        if (loaded.role === 'viewer') {
            return { response: { type: 'error', code: 'FORBIDDEN', message: 'Viewer access is read-only.' } };
        }

        const intent = requireGenerationIntent(state.intent);
        const recentMessages = await dependencies.repository.listRecentMessages(state.projectId, dependencies.historyLimit);
        await dependencies.repository.appendMessage({
            projectId: state.projectId,
            userId: state.userId,
            role: 'user',
            content: state.message,
            intent,
            ...(state.assets.length > 0 ? {
                assets: state.assets.map((asset) => ({
                    assetId: asset.assetId,
                    role: asset.role === 'reference' ? 'REFERENCE' as const : 'ASSET' as const,
                })),
            } : {}),
        });

        return { project: loaded.project, recentMessages };
    };
}
