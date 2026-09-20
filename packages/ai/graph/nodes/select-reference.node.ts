import { loadReference, loadReferenceIndex } from '../../../motify-references/loader.js';
import {
    buildReferenceSelectionPrompt,
    REFERENCE_SELECTION_LIMITS,
    REFERENCE_SELECTION_SYSTEM_PROMPT,
} from '../../prompts/reference.prompt.js';
import { referenceSelectionSchema } from '../../schemas/reference-selection.schema.js';
import type { ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/**
 * Attaches one finished film for the generator to work against.
 *
 * Only CREATE: an edit already has a house style on screen to match. Any failure
 * here leaves the reference unset and generation proceeds without one.
 */
export function createSelectReferenceNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        if (state.intent !== 'CREATE') return {};
        try {
            const index = await loadReferenceIndex();
            const { referenceId } = await dependencies.provider.structured({
                model: dependencies.model,
                systemInstructions: REFERENCE_SELECTION_SYSTEM_PROMPT,
                prompt: buildReferenceSelectionPrompt(state.message, index),
                schemaName: 'motify_reference_selection',
                schema: referenceSelectionSchema,
                limits: REFERENCE_SELECTION_LIMITS,
            });
            if (!referenceId.trim()) return {};
            return { reference: await loadReference(referenceId.trim()) };
        } catch {
            return {};
        }
    };
}
