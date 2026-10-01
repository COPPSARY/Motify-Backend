import { brandAssetTokens } from '../../prompts/brand.prompt.js';
import { requireCandidate, type ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

const ASSET_TOKEN = /motify-asset:\/\/[0-9a-f-]{36}/gi;

/** Checks the candidate deterministically. Generated source is never executed. */
export function createValidateNode(dependencies: ResolvedMotionGraphDependencies) {
    return (state: MotionGraphState): MotionGraphUpdate => {
        const report = dependencies.validate(requireCandidate(state.generation), {
            requiredAssetTokens: state.assets
                .filter((asset) => asset.role === 'asset')
                .map((asset) => `motify-asset://${asset.assetId}`),
            requiredAudioTokens: state.audio.map((track) => `motify-audio://${track.trackId}`),
            // Brand images may be placed but never have to be. Tokens the saved
            // project already carries stay legal, so an edit still validates
            // after its logo was swapped out of the brand.
            optionalAssetTokens: [
                ...brandAssetTokens(state.brand),
                ...(state.project?.compositionHtml.match(ASSET_TOKEN) ?? []),
            ],
        });
        return { validationErrors: report.errors, validationWarnings: report.warnings };
    };
}
