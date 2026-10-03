import { tool } from '@langchain/core/tools';

import { validateMotifyGeneration, type ValidationReport } from '../../validation/generation-validator.js';
import { motifyGenerationDraftSchema } from '../generation-schema.js';
import { completeGeneration, readWorkspaceFiles } from '../workspace-generation.js';

export interface ValidateGenerationToolOptions {
    requiredAssetTokens?: readonly string[];
    requiredAudioTokens?: readonly string[];
    /** Called with every report this tool returns, so a caller can count how often a film fails. */
    onReport?: (report: ValidationReport) => void;
}

/**
 * A tool the agent calls on its own draft before finalizing: a self-check that lets it fix errors
 * early. `finalize_generation` enforces the same validation, so a film that fails it is never saved.
 */
export function createValidateGenerationTool(options: ValidateGenerationToolOptions = {}) {
    return tool(
        async (input) => {
            const completed = completeGeneration(input, readWorkspaceFiles());
            if (!completed.ok) {
                const missing: ValidationReport = {
                    valid: false,
                    errors: completed.missing.map((field) => ({ code: 'DRAFT_MISSING', field, message: completed.message })),
                    warnings: [],
                };
                options.onReport?.(missing);
                return JSON.stringify(missing);
            }
            const report = validateMotifyGeneration(completed.generation, {
                requiredAssetTokens: options.requiredAssetTokens ?? [],
                requiredAudioTokens: options.requiredAudioTokens ?? [],
            });
            options.onReport?.(report);
            return JSON.stringify(report);
        },
        {
            name: 'validate_generation',
            description: 'Checks your current Motify draft for structural errors and house-style warnings. Pass title, duration, width, height, fps, scenes and reply; compositionHtml and timelineJs are read from /composition.html and /timeline.js in your workspace, so write those with write_file first and do NOT repeat their content here. Call this before finalize_generation. Returns { valid, errors, warnings }.',
            schema: motifyGenerationDraftSchema,
        },
    );
}
