import type { RoutedSkill } from '../../motify-skills/router.js';
import type { GenerationIntent, MotifyProject } from '../graph/dependencies.js';
import type { ModelRequestLimits, MotifyGeneration } from '../providers/model.provider.js';
import type { ValidationError } from '../validation/generation-validator.js';
import { buildMotionSystemPrompt, describeProject, MAX_GENERATION_OUTPUT_TOKENS, NO_PROJECT_YET } from './motion.prompt.js';

export const REPAIR_LIMITS: ModelRequestLimits = { maxOutputTokens: MAX_GENERATION_OUTPUT_TOKENS, thinking: 'auto' };

const FENCE = '```';

const REPAIR_RULES = [
    'The candidate you produced failed Motify validation. Repair it.',
    'Keep the design, copy, timing, and structure you already produced. Change only what the diagnostics require.',
    'Do not redesign the composition and do not start over unless a diagnostic makes that unavoidable.',
    'Return the complete corrected project, not a patch or a description of the fix.',
].join('\n');

export function buildRepairSystemPrompt(skills: RoutedSkill[]): string {
    return `${buildMotionSystemPrompt(skills)}\n\n${REPAIR_RULES}`;
}

export interface RepairPromptInput {
    intent: GenerationIntent;
    message: string;
    project?: MotifyProject | undefined;
    candidate: MotifyGeneration;
    errors: ValidationError[];
}

export function buildRepairUserPrompt(input: RepairPromptInput): string {
    return [
        `Original ${input.intent} request:\n${input.message}`,
        `Validation diagnostics:\n${formatErrors(input.errors)}`,
        [
            'Rejected candidate compositionHtml:',
            `${FENCE}html\n${input.candidate.compositionHtml}\n${FENCE}`,
            '',
            'Rejected candidate timelineJs:',
            `${FENCE}js\n${input.candidate.timelineJs}\n${FENCE}`,
        ].join('\n'),
        input.project ? describeProject(input.project) : NO_PROJECT_YET,
    ].join('\n\n');
}

function formatErrors(errors: ValidationError[]): string {
    return errors.map((error) => `- ${error.field} ${error.code}: ${error.message}`).join('\n');
}
