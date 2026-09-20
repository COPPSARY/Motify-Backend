import { Annotation } from '@langchain/langgraph';

import type { RoutedSkill } from '../../motify-skills/router.js';
import type { ChatMessage, ModelTokenUsage, MotifyGeneration, PromptImage } from '../providers/model.provider.js';
import type { LoadedReference } from '../../motify-references/loader.js';
import type { MotionBrief } from '../schemas/brief.schema.js';
import type { Intent } from '../schemas/intent.schema.js';
import type { ValidationError } from '../validation/generation-validator.js';
import type { MotionGraphResponse, MotifyProject } from './dependencies.js';

function replace<T>(_current: T, next: T): T {
    return next;
}

/**
 * One shared state for every node. Input channels mirror `MotionGraphInput`; the
 * remaining channels are filled in as the graph progresses.
 */
export const MotionGraphAnnotation = Annotation.Root({
    userId: Annotation<string>,
    workspaceId: Annotation<string>,
    projectId: Annotation<string | undefined>,
    message: Annotation<string>,
    runtimeError: Annotation<{ message: string } | undefined>,
    revision: Annotation<number | undefined>,
    referenceAssetIds: Annotation<string[]>({ reducer: replace, default: () => [] }),
    referenceImages: Annotation<PromptImage[]>({ reducer: replace, default: () => [] }),

    startedAtMs: Annotation<number>({ reducer: replace, default: () => 0 }),
    intent: Annotation<Intent | undefined>,
    project: Annotation<MotifyProject | undefined>,
    recentMessages: Annotation<ChatMessage[]>({ reducer: replace, default: () => [] }),
    selectedSkills: Annotation<RoutedSkill[]>({ reducer: replace, default: () => [] }),
    brief: Annotation<MotionBrief | undefined>,
    reference: Annotation<LoadedReference | undefined>,
    generation: Annotation<MotifyGeneration | undefined>,
    tokenUsage: Annotation<ModelTokenUsage>({
        reducer: (current, next) => ({
            inputTokens: addTokenUsage(current.inputTokens, next.inputTokens),
            outputTokens: addTokenUsage(current.outputTokens, next.outputTokens),
        }),
        default: () => ({ inputTokens: null, outputTokens: null }),
    }),
    validationErrors: Annotation<ValidationError[]>({ reducer: replace, default: () => [] }),
    repairAttempts: Annotation<number>({ reducer: replace, default: () => 0 }),
    savedRevision: Annotation<number | undefined>,
    response: Annotation<MotionGraphResponse | undefined>,
});

function addTokenUsage(current: number | null, next: number | null): number | null {
    if (current === null && next === null) return null;
    return (current ?? 0) + (next ?? 0);
}

export type MotionGraphState = typeof MotionGraphAnnotation.State;
export type MotionGraphUpdate = typeof MotionGraphAnnotation.Update;
