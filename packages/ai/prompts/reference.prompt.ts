import type { LoadedReference, ReferenceEntry } from '../../motify-references/loader.js';
import type { ModelRequestLimits } from '../providers/model.provider.js';

export const REFERENCE_SELECTION_LIMITS: ModelRequestLimits = { maxOutputTokens: 4_000, thinking: 'auto' };

export const REFERENCE_SELECTION_SYSTEM_PROMPT = [
    'Pick the one finished Motify film whose construction best fits the request, or none.',
    'Match on how the film is built - what persists across cuts, whether it shows a mechanism or an interface, how restrained it is - not on subject matter.',
    'Answer with that film\'s id, or an empty string when none of them is a useful model for this request.',
].join('\n');

export function buildReferenceSelectionPrompt(message: string, index: ReferenceEntry[]): string {
    return [
        'Available films:',
        ...index.map((entry) => `${entry.id}: ${entry.title}. ${entry.description}`),
        '',
        `Request:\n${message}`,
    ].join('\n');
}

const FENCE = '```';

/**
 * A finished film, shown so the model has a standard of density and craft to
 * work against instead of inventing one. The skill describes these films in
 * prose and names them; until now the films themselves were never in the prompt.
 *
 * Two mechanical differences are called out because the preset sources are
 * frontend modules: they import their helpers and name their entry point after
 * themselves, and generated output may do neither.
 */
export function describeReference(reference: LoadedReference): string {
    return [
        `Reference film: ${reference.title}`,
        reference.description,
        '',
        'Study how it is built: the density of its markup, its scoped CSS system, how it uses EASE and the motion presets, how it carries one element across cuts, and how it names data-edit identifiers.',
        'Work to this standard. Reuse its mechanisms, not its copy, palette, layout or timings - those belong to its own subject, and reproducing them is a failed generation.',
        'Two differences from your own output: it imports its helpers and names its entry point after itself. Yours imports nothing and exports buildTimeline.',
        '',
        `${FENCE}html`,
        reference.compositionHtml,
        FENCE,
        '',
        `${FENCE}js`,
        reference.timelineJs,
        FENCE,
    ].join('\n');
}
