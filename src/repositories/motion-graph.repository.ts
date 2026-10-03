import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type {
    CreateGraphProjectInput,
    GenerationRunInput,
    GraphProjectRepository,
    MotifyProject,
    MotifyScene,
    OverwriteGraphProjectInput,
    StoredMessageInput,
} from '../../packages/ai/agent/dependencies.js';
import type { MotifyGeneration } from '../../packages/ai/agent/generation-schema.js';
import type { Database } from '../../packages/database/client.js';
import { generationRuns, messageAssets, messages, projects, workspaceMembers } from '../../packages/database/schema.js';

type ProjectRow = typeof projects.$inferSelect;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

function slugPart(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'project';
}

function toGraphProject(row: ProjectRow): MotifyProject {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.name,
        duration: row.duration,
        width: row.width,
        height: row.height,
        fps: row.fps,
        scenes: row.scenes as MotifyScene[],
        compositionHtml: row.compositionHtml,
        timelineJs: row.timelineJs,
        revision: row.revision,
    };
}

function generatedFields(generation: MotifyGeneration) {
    return {
        name: generation.title,
        width: Math.round(generation.width),
        height: Math.round(generation.height),
        fps: Math.round(generation.fps),
        duration: generation.duration,
        scenes: generation.scenes as unknown as Record<string, unknown>[],
        compositionHtml: generation.compositionHtml,
        timelineJs: generation.timelineJs,
    };
}

/**
 * Drizzle implementation of the graph persistence port. Each write that a caller must
 * see as one step — project source, transcript, and audit run — happens in a single
 * transaction, and an overwrite only lands on the revision the model generated from.
 */
export class DatabaseMotionGraphRepository implements GraphProjectRepository {
    constructor(private readonly db: Database) {}

    async loadWorkspaceForGraph(workspaceId: string, userId: string) {
        const [membership] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers)
            .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
        return membership ?? null;
    }

    async loadProjectAccess(projectId: string, userId: string) {
        const [row] = await this.db.select({ workspaceId: projects.workspaceId, role: workspaceMembers.role }).from(projects)
            .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId)))
            .where(and(eq(projects.id, projectId), isNull(projects.archivedAt))).limit(1);
        return row ?? null;
    }

    async loadForGraph(projectId: string, userId: string) {
        const [row] = await this.db.select({ project: projects, role: workspaceMembers.role }).from(projects)
            .innerJoin(
                workspaceMembers,
                and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId)),
            )
            .where(and(eq(projects.id, projectId), isNull(projects.archivedAt))).limit(1);
        return row ? { project: toGraphProject(row.project), role: row.role } : null;
    }

    /** Newest rows are cheapest to fetch, so the window is reversed back into reading order. */
    async listRecentMessages(projectId: string, limit: number) {
        const rows = await this.db.select({ role: messages.role, content: messages.content }).from(messages)
            .where(eq(messages.projectId, projectId))
            .orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit);
        return rows.reverse();
    }

    async appendMessage(input: StoredMessageInput) {
        if (!input.assets?.length) {
            await insertMessage(this.db, input);
            return;
        }
        await this.db.transaction(async (transaction) => {
            const [message] = await insertMessage(transaction, input);
            if (!message) throw new Error('Unable to append the project message.');
            await transaction.insert(messageAssets).values(input.assets!.map((asset) => ({
                messageId: message.id,
                assetId: asset.assetId,
                role: asset.role,
            })));
        });
    }

    async createForGraph(workspaceId: string, userId: string, input: CreateGraphProjectInput) {
        return this.db.transaction(async (transaction) => {
            const [membership] = await transaction.select({ role: workspaceMembers.role }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
            if (!membership || membership.role === 'viewer') return null;

            // `now()` is the transaction timestamp, so the request and the reply would share
            // one instant. The transcript order is set explicitly instead of relying on it.
            const askedAt = new Date();
            const [created] = await transaction.insert(projects).values({
                workspaceId,
                createdBy: userId,
                slug: `${slugPart(input.generation.title)}-${randomUUID().slice(0, 8)}`,
                ...generatedFields(input.generation),
            }).returning();
            if (!created) throw new Error('Unable to create the generated project.');

            await insertMessage(transaction, { projectId: created.id, userId, role: 'user', content: input.message }, askedAt);
            await insertMessage(transaction, { projectId: created.id, userId, role: 'assistant', content: input.generation.reply }, new Date(askedAt.getTime() + 1));
            await insertRun(transaction, {
                projectId: created.id,
                baseRevision: 0,
                savedRevision: created.revision,
                model: input.model,
                status: 'COMPLETED',
                latencyMs: input.latencyMs,
                inputTokens: input.inputTokens,
                outputTokens: input.outputTokens,
            }, 'CREATE');

            return toGraphProject(created);
        });
    }

    async overwriteForGraph(projectId: string, input: OverwriteGraphProjectInput) {
        return this.db.transaction(async (transaction) => {
            const [overwritten] = await transaction.update(projects).set({
                ...generatedFields(input.generation),
                revision: sql`${projects.revision} + 1`,
                updatedAt: new Date(),
            }).where(and(
                eq(projects.id, projectId),
                eq(projects.revision, input.expectedRevision),
                isNull(projects.archivedAt),
            )).returning();
            if (!overwritten) return null;

            await insertMessage(transaction, {
                projectId, userId: input.userId, role: 'assistant', content: input.generation.reply,
            });
            await insertRun(transaction, {
                projectId,
                baseRevision: input.expectedRevision,
                savedRevision: overwritten.revision,
                model: input.model,
                status: 'COMPLETED',
                latencyMs: input.latencyMs,
                inputTokens: input.inputTokens,
                outputTokens: input.outputTokens,
            }, input.isFix ? 'FIX' : 'EDIT');

            return toGraphProject(overwritten);
        });
    }

    /**
     * Only ever called for an in-flight edit that ran out of step budget (see
     * `createMotifyAgentRunner`'s `GraphRecursionError` handler, which guards
     * this on `projectId !== undefined`), so the run is logged as `FIX` or
     * `EDIT` depending on whether that turn was repairing a runtime error
     * (`input.isFix`, threaded from `MotionGraphInput.runtimeError`).
     */
    async recordRun(input: GenerationRunInput) {
        await insertRun(this.db, input, input.isFix ? 'FIX' : 'EDIT');
    }

    async recordRunUsage(input: { projectId: string; savedRevision: number; inputTokens: number | null; outputTokens: number | null }) {
        await this.db.update(generationRuns)
            .set({ inputTokens: input.inputTokens, outputTokens: input.outputTokens })
            .where(and(
                eq(generationRuns.projectId, input.projectId),
                eq(generationRuns.savedRevision, input.savedRevision),
                eq(generationRuns.status, 'COMPLETED'),
            ));
    }
}

function insertMessage(executor: Executor, input: StoredMessageInput, createdAt?: Date) {
    return executor.insert(messages).values({
        projectId: input.projectId,
        userId: input.userId,
        role: input.role,
        content: input.content,
        ...(createdAt ? { createdAt } : {}),
    }).returning({ id: messages.id });
}

/**
 * `intent`, `selectedSkills`, and `repairAttempts` are columns the old
 * LangGraph pipeline populated from its own intent classifier and skill
 * router. The deep agent has neither, so `GenerationRunInput` no longer
 * carries `selectedSkills`/`repairAttempts` (they fall back to their schema
 * defaults, `[]` / `0`). `intent` is still supplied by each call site
 * (CREATE for a new project; EDIT or FIX for an existing one, the latter
 * exactly when `input.isFix`/`OverwriteGraphProjectInput.isFix` is true) —
 * unlike the rest of the old classifier's output, FIX was never a model
 * judgment: it was always set directly from whether the request carried a
 * runtime error report, a fact still available today via
 * `MotionGraphInput.runtimeError` and threaded straight through.
 */
function insertRun(executor: Executor, input: GenerationRunInput, intent: 'CREATE' | 'EDIT' | 'FIX') {
    return executor.insert(generationRuns).values({
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        savedRevision: input.savedRevision,
        intent,
        model: input.model,
        status: input.status,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
    });
}
