import { loadSkillBundle, type LoadedSkill, type SkillManifest } from '../../motify-skills/loader.js';
import type { ChatMessage, ModelImageInput, MotifyGeneration, MotionModelProvider } from '../providers/model.provider.js';
import type { MotionBrief } from '../schemas/brief.schema.js';
import type { Intent } from '../schemas/intent.schema.js';
import { validateMotifyGeneration, type GenerationValidationOptions, type ValidationError, type ValidationReport } from '../validation/generation-validator.js';

/** Scenes are stored exactly as the model produced them inside the generation contract. */
export type MotifyScene = MotifyGeneration['scenes'][number];

/** Intents that load project context, generate source, and may overwrite the project. */
export type GenerationIntent = Extract<Intent, 'CREATE' | 'EDIT' | 'FIX'>;

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
    intent: Intent;
    assets?: Array<{ assetId: string; role: 'REFERENCE' | 'ASSET' }>;
}

export interface OverwriteGraphProjectInput {
    userId: string;
    expectedRevision: number;
    intent: GenerationIntent;
    generation: MotifyGeneration;
    model: string;
    selectedSkills: string[];
    repairAttempts: number;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
}

export interface CreateGraphProjectInput {
    message: string;
    generation: MotifyGeneration;
    model: string;
    selectedSkills: string[];
    repairAttempts: number;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
}

export interface GenerationRunInput {
    projectId: string;
    baseRevision: number;
    savedRevision: number | null;
    intent: GenerationIntent;
    model: string;
    selectedSkills: string[];
    repairAttempts: number;
    status: 'COMPLETED' | 'FAILED';
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
}

/**
 * Persistence port for the graph. `overwriteForGraph` must compare the expected
 * revision, write every generated field, append the assistant message, and record
 * the completed run inside one transaction, returning `null` for a stale revision.
 * `createForGraph` must verify workspace write access itself and return `null` when
 * the user may not create in that workspace.
 */
export interface GraphProjectRepository {
    loadProjectAccess(projectId: string, userId: string): Promise<{ workspaceId: string; role: GraphWorkspaceRole } | null>;
    loadForGraph(projectId: string, userId: string): Promise<{ project: MotifyProject; role: GraphWorkspaceRole } | null>;
    listRecentMessages(projectId: string, limit: number): Promise<ChatMessage[]>;
    appendMessage(input: StoredMessageInput): Promise<void>;
    createForGraph(workspaceId: string, userId: string, input: CreateGraphProjectInput): Promise<MotifyProject | null>;
    overwriteForGraph(projectId: string, input: OverwriteGraphProjectInput): Promise<MotifyProject | null>;
    recordRun(input: GenerationRunInput): Promise<void>;
}

export type MotionGraphResponse =
    | { type: 'chat'; message: string }
    | { type: 'plan'; message: string }
    | { type: 'generation'; message: string; projectId: string; revision: number; created: boolean }
    | { type: 'error'; code: 'PROJECT_NOT_FOUND' | 'FORBIDDEN'; message: string }
    | { type: 'error'; code: 'REVISION_CONFLICT'; message: string; currentRevision: number }
    | { type: 'error'; code: 'GENERATION_INVALID'; message: string; errors: ValidationError[] };

export interface MotionGraphInput {
    userId: string;
    workspaceId: string;
    message: string;
    /** Absent for a first generation: the graph then creates a project in the workspace. */
    projectId?: string;
    /** Present only when the frontend reports a rendering failure; selects `FIX`. */
    runtimeError?: { message: string };
    /** Revision the caller generated against; required for runtime repair. */
    revision?: number;
    assets?: ModelImageInput[];
    audio?: GenerationAudioTrack[];
}

export interface SkillBundle {
    manifest: SkillManifest;
    skills: LoadedSkill[];
}

export interface BriefLog {
    beats: number;
    defects: string[];
}

export interface SkillSelectionLog {
    intent: GenerationIntent;
    manifestVersion: string;
    skills: Array<{ id: string; reason: string }>;
    totalCharacters: number;
}

export interface MotionGraphDependencies {
    provider: MotionModelProvider;
    repository: GraphProjectRepository;
    model: string;
    loadSkills?: () => Promise<SkillBundle>;
    validate?: (generation: MotifyGeneration, options?: GenerationValidationOptions) => ValidationReport;
    now?: () => number;
    maxRepairAttempts?: number;
    historyLimit?: number;
    onSkillsSelected?: (selection: SkillSelectionLog) => void;
    onBrief?: (log: BriefLog) => void;
}

export interface ResolvedMotionGraphDependencies {
    provider: MotionModelProvider;
    repository: GraphProjectRepository;
    model: string;
    loadSkills: () => Promise<SkillBundle>;
    validate: (generation: MotifyGeneration, options?: GenerationValidationOptions) => ValidationReport;
    now: () => number;
    maxRepairAttempts: number;
    historyLimit: number;
    onSkillsSelected: (selection: SkillSelectionLog) => void;
    onBrief: (log: BriefLog) => void;
}

export const MAX_REPAIR_ATTEMPTS = 2;
export const RECENT_MESSAGE_LIMIT = 12;

export function resolveMotionGraphDependencies(
    dependencies: MotionGraphDependencies,
): ResolvedMotionGraphDependencies {
    return {
        provider: dependencies.provider,
        repository: dependencies.repository,
        model: dependencies.model,
        loadSkills: dependencies.loadSkills ?? (() => loadSkillBundle('v1')),
        validate: dependencies.validate ?? validateMotifyGeneration,
        now: dependencies.now ?? (() => Date.now()),
        maxRepairAttempts: dependencies.maxRepairAttempts ?? MAX_REPAIR_ATTEMPTS,
        historyLimit: dependencies.historyLimit ?? RECENT_MESSAGE_LIMIT,
        onSkillsSelected: dependencies.onSkillsSelected ?? (() => {}),
        onBrief: dependencies.onBrief ?? (() => {}),
    };
}

export function isGenerationIntent(intent: Intent | undefined): intent is GenerationIntent {
    return intent === 'CREATE' || intent === 'EDIT' || intent === 'FIX';
}

/**
 * Graph routing guarantees these values before the generation nodes run; the guards
 * turn a broken graph wiring into an obvious error instead of a bad model call.
 */
export function requireGenerationIntent(intent: Intent | undefined): GenerationIntent {
    if (!isGenerationIntent(intent)) throw new Error('A Motify generation node ran without a generation intent.');
    return intent;
}

export function requireProject(project: MotifyProject | undefined): MotifyProject {
    if (!project) throw new Error('A Motify generation node ran without a loaded project.');
    return project;
}

export function requireCandidate(generation: MotifyGeneration | undefined): MotifyGeneration {
    if (!generation) throw new Error('A Motify generation node ran without a candidate generation.');
    return generation;
}
