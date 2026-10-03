import { getCurrentTaskInput } from '@langchain/langgraph';

import type { MotifyGeneration, MotifyGenerationDraft } from './generation-schema.js';

export const COMPOSITION_PATH = '/composition.html';
export const TIMELINE_PATH = '/timeline.js';

/** The shape deepagents keeps its virtual files in; `content` is text or, in some versions, lines. */
export type WorkspaceFiles = Record<string, { content?: unknown } | null | undefined>;

export type CompletedGeneration =
    | { ok: true; generation: MotifyGeneration }
    | { ok: false; missing: Array<'compositionHtml' | 'timelineJs'>; message: string };

function fileText(files: WorkspaceFiles, path: string): string | undefined {
    const content = files[path]?.content;
    const text = Array.isArray(content) ? content.join('\n') : content;
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined;
}

/**
 * Builds the full generation from what the agent passed plus its drafted files.
 * Content passed in the call wins over the file, so an agent that still sends the
 * whole film works exactly as before.
 */
export function completeGeneration(draft: MotifyGenerationDraft, files: WorkspaceFiles): CompletedGeneration {
    const compositionHtml = draft.compositionHtml ?? fileText(files, COMPOSITION_PATH);
    const timelineJs = draft.timelineJs ?? fileText(files, TIMELINE_PATH);

    const missing: Array<'compositionHtml' | 'timelineJs'> = [];
    if (compositionHtml === undefined) missing.push('compositionHtml');
    if (timelineJs === undefined) missing.push('timelineJs');
    if (compositionHtml === undefined || timelineJs === undefined) {
        const paths = missing.map((field) => (field === 'compositionHtml' ? COMPOSITION_PATH : TIMELINE_PATH));
        return {
            ok: false,
            missing,
            message: `Write ${paths.join(' and ')} with write_file first (or pass the content in this call), then call this tool again.`,
        };
    }
    return { ok: true, generation: { ...draft, compositionHtml, timelineJs } };
}

/**
 * The agent's current virtual files, read from the running graph. Outside a run (a
 * tool invoked directly) there is no graph, so there are no files.
 */
export function readWorkspaceFiles(): WorkspaceFiles {
    try {
        const state = getCurrentTaskInput() as { files?: WorkspaceFiles } | undefined;
        return state?.files ?? {};
    } catch {
        return {};
    }
}
