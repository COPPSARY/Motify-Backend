import type { BrandAssetRole, BrandDna } from '../../brand/brand-dna.js';
import type { ValidationError } from '../validation/generation-validator.js';
import type { MotifyGeneration } from './generation-schema.js';
import type { ModelProviderName } from './errors.js';

/** Scenes are stored exactly as the model produced them inside the generation contract. */
export type MotifyScene = MotifyGeneration['scenes'][number];

/** Mirrors the `workspace_role` database enum. */
export type GraphWorkspaceRole = 'owner' | 'editor' | 'viewer';

/**
 * A music-library track offered to a generation. Only metadata reaches the model;
 * it places the track by its `motify-audio://` token and paces the film to it.
 */
export interface GenerationAudioTrack {
    trackId: string;
    title: string;
    artist: string | null;
    genre: string | null;
    moodTags: string[];
    bpm: number | null;
    durationMs: number;
}

/** A brand image the model may place, by its `motify-asset://` token. */
export interface GenerationBrandAsset {
    assetId: string;
    role: BrandAssetRole;
    label: string | null;
    fileName: string;
    contentType: string;
    width: number | null;
    height: number | null;
}

/**
 * The workspace's Brand DNA as a generation sees it. Loaded server-side for
 * every message, so the brand never depends on what the editor chose to send.
 */
export interface GenerationBrand {
    dna: BrandDna;
    assets: GenerationBrandAsset[];
}

export interface ModelImageInput {
    assetId: string;
    fileName: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    dataBase64: string;
    /**
     * What the image is to this generation. An `asset` is placed in the film
     * and a `reference` is imitated, so both describe something the user
     * supplied. A `frame` is neither: it is a picture of the candidate this
     * request is repairing, rendered by the editor, and the one thing the
     * agent must not do with it is reproduce it.
     */
    role: 'reference' | 'asset' | 'frame';
    /** Where in the film a `frame` was taken, in seconds. */
    capturedAtSeconds?: number;
}

/** The current, mutable Motify project state the frontend renders. */
export interface MotifyProject {
    id: string;
    workspaceId: string;
    title: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
    scenes: MotifyScene[];
    compositionHtml: string;
    timelineJs: string;
    revision: number;
}

export interface StoredMessageInput {
    projectId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    assets?: Array<{ assetId: string; role: 'REFERENCE' | 'ASSET' }>;
}

export interface OverwriteGraphProjectInput {
    userId: string;
    expectedRevision: number;
    generation: MotifyGeneration;
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    /**
     * Whether this turn was repairing a reported runtime failure
     * (`MotionGraphInput.runtimeError` was set). Unlike the old pipeline's
     * intent, this was never something a model classified — it is a
     * deterministic fact of the request — so it is threaded straight through
     * from `createMotifyAgentRunner` rather than re-derived here. Recorded as
     * `FIX` instead of `EDIT` when true (see `GenerationRunInput.isFix`).
     */
    isFix?: boolean;
}

export interface CreateGraphProjectInput {
    message: string;
    generation: MotifyGeneration;
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
}

export interface GenerationRunInput {
    projectId: string;
    baseRevision: number;
    savedRevision: number | null;
    status: 'COMPLETED' | 'FAILED';
    model: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    /** See `OverwriteGraphProjectInput.isFix`. Only meaningful for a run against an existing project. */
    isFix?: boolean;
}

/**
 * Persistence port for the agent. `overwriteForGraph` must compare the expected
 * revision, write every generated field, append the assistant message, and record
 * the completed run inside one transaction, returning `null` for a stale revision.
 * `createForGraph` must verify workspace write access itself and return `null` when
 * the user may not create in that workspace.
 */
export interface GraphProjectRepository {
    loadProjectAccess(projectId: string, userId: string): Promise<{ workspaceId: string; role: GraphWorkspaceRole } | null>;
    loadForGraph(projectId: string, userId: string): Promise<{ project: MotifyProject; role: GraphWorkspaceRole } | null>;
    listRecentMessages(projectId: string, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
    appendMessage(input: StoredMessageInput): Promise<void>;
    createForGraph(workspaceId: string, userId: string, input: CreateGraphProjectInput): Promise<MotifyProject | null>;
    overwriteForGraph(projectId: string, input: OverwriteGraphProjectInput): Promise<MotifyProject | null>;
    recordRun(input: GenerationRunInput): Promise<void>;
    /**
     * Fills in the token counts of the completed run that saved `savedRevision`.
     * `finalize_generation` writes that row mid-run, before the agent's last model
     * call, so the totals are only known once the whole run has finished.
     */
    recordRunUsage(input: { projectId: string; savedRevision: number; inputTokens: number | null; outputTokens: number | null }): Promise<void>;
}



export type MotionGraphResponse =
    | { type: 'chat'; message: string }
    | { type: 'generation'; message: string; projectId: string; revision: number; created: boolean }
    | { type: 'error'; code: 'PROJECT_NOT_FOUND' | 'FORBIDDEN'; message: string }
    | { type: 'error'; code: 'REVISION_CONFLICT'; message: string; currentRevision: number }
    | { type: 'error'; code: 'GENERATION_INVALID'; message: string; errors: ValidationError[] };

export interface MotionGraphInput {
    userId: string;
    workspaceId: string;
    message: string;
    /** Absent for a first generation: the agent then creates a project in the workspace. */
    projectId?: string;
    /** Present only when the frontend reports a rendering failure. */
    runtimeError?: { message: string };
    /** Revision the caller generated against; required for runtime repair. */
    revision?: number;
    assets?: ModelImageInput[];
    audio?: GenerationAudioTrack[];
    brand?: GenerationBrand;
}

// A LangGraph superstep count, not a tool-call count. Each real model turn
// costs roughly 3 steps with the current skills-middleware stack, so 75
// allows for roughly 25 real turns (skill-browsing + planning + drafting
// files + validating + fixing + finalizing) — tune further with a
// real-model smoke test before production use.
export const DEFAULT_MAX_STEPS = 50;
export const DEFAULT_HISTORY_LIMIT = 12;
/** After a first attempt that fails validation, the agent may retry this many times before the run is cut off. */
export const DEFAULT_MAX_VALIDATION_RETRIES = 2;

export interface MotifyAgentDependencies {
    model: import('@langchain/core/language_models/chat_models').BaseChatModel;
    repository: GraphProjectRepository;
    skillsRoot: string;
    /** Kiri TTS (or any other future MCP server's) tools, fetched once at startup. */
    mcpTools?: import('@langchain/core/tools').StructuredToolInterface[];
    audioSearch?: (userId: string, workspaceId: string, query: string | undefined) => Promise<GenerationAudioTrack[]>;
    now?: () => number;
    maxSteps?: number;
    /** How many times a film that fails validation may be retried; see `DEFAULT_MAX_VALIDATION_RETRIES`. */
    maxValidationRetries?: number;
    historyLimit?: number;
    /** Which provider `model` was built from, used to shape thrown errors via `normalizeProviderError`. Defaults to `'anthropic'` when omitted. */
    providerName?: ModelProviderName;
}

export interface ResolvedMotifyAgentDependencies {
    model: import('@langchain/core/language_models/chat_models').BaseChatModel;
    repository: GraphProjectRepository;
    skillsRoot: string;
    mcpTools: import('@langchain/core/tools').StructuredToolInterface[];
    audioSearch?: (userId: string, workspaceId: string, query: string | undefined) => Promise<GenerationAudioTrack[]>;
    now: () => number;
    maxSteps: number;
    maxValidationRetries: number;
    historyLimit: number;
    providerName: ModelProviderName;
}

export function resolveMotifyAgentDependencies(dependencies: MotifyAgentDependencies): ResolvedMotifyAgentDependencies {
    return {
        model: dependencies.model,
        repository: dependencies.repository,
        skillsRoot: dependencies.skillsRoot,
        mcpTools: dependencies.mcpTools ?? [],
        ...(dependencies.audioSearch !== undefined ? { audioSearch: dependencies.audioSearch } : {}),
        now: dependencies.now ?? (() => Date.now()),
        maxSteps: dependencies.maxSteps ?? DEFAULT_MAX_STEPS,
        maxValidationRetries: dependencies.maxValidationRetries ?? DEFAULT_MAX_VALIDATION_RETRIES,
        historyLimit: dependencies.historyLimit ?? DEFAULT_HISTORY_LIMIT,
        providerName: dependencies.providerName ?? 'anthropic',
    };
}
