import { requireCandidate, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/** Checks the candidate deterministically. Generated source is never executed. */
export function createValidateNode(dependencies: ResolvedMotionGraphDependencies) {
    return (state: MotionGraphState): MotionGraphUpdate => {
        const report = dependencies.validate(requireCandidate(state.generation), {
            requiredAssetTokens: state.assets
                .filter((asset) => asset.role === 'asset')
                .map((asset) => `motify-asset://${asset.assetId}`),
        });
        return { validationErrors: report.errors, validationWarnings: report.warnings };
    };
}
