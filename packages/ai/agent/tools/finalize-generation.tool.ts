import { tool } from '@langchain/core/tools';

import type { GraphProjectRepository, MotifyProject } from '../dependencies.js';
import { motifyGenerationSchema, type MotifyGeneration } from '../generation-schema.js';

export type FinalizeOutcome =
    | { type: 'created'; project: MotifyProject }
    | { type: 'overwritten'; project: MotifyProject }
    | { type: 'conflict' };

export interface FinalizeGenerationContext {
    repository: GraphProjectRepository;
    userId: string;
    workspaceId: string;
    projectId?: string;
    /** Required when `projectId` is set; this is the hard revision-conflict guardrail (spec §3.3). */
    expectedRevision?: number;
    /** Whether this turn is repairing a reported runtime failure; threaded to `overwriteForGraph` as `isFix` (see its doc comment). */
    isFix?: boolean;
    message: string;
    model: string;
    now: () => number;
    startedAtMs: number;
    onFinalized: (outcome: FinalizeOutcome) => void;
}

/**
 * Persists the agent's finished generation to Postgres — the only place this
 * migration performs a database write. The revision-conflict check here is
 * deterministic code, not agent judgment (spec §3.3): a stale `expectedRevision`
 * always reports `conflict`, regardless of what the model intended.
 */
export function createFinalizeGenerationTool(context: FinalizeGenerationContext) {
    return tool(
        async (input: MotifyGeneration) => {
            const latencyMs = context.now() - context.startedAtMs;
            if (context.projectId !== undefined) {
                if (context.expectedRevision === undefined) {
                    throw new Error('finalize_generation requires an expected revision when editing an existing project.');
                }
                const project = await context.repository.overwriteForGraph(context.projectId, {
                    userId: context.userId,
                    expectedRevision: context.expectedRevision,
                    generation: input,
                    model: context.model,
                    latencyMs,
                    inputTokens: null,
                    outputTokens: null,
                    ...(context.isFix !== undefined ? { isFix: context.isFix } : {}),
                });
                if (!project) {
                    context.onFinalized({ type: 'conflict' });
                    return JSON.stringify({ status: 'conflict', message: 'The project changed since you loaded it. Ask the user to retry.' });
                }
                context.onFinalized({ type: 'overwritten', project });
                return JSON.stringify({ status: 'saved', revision: project.revision });
            }

            const project = await context.repository.createForGraph(context.workspaceId, context.userId, {
                message: context.message,
                generation: input,
                model: context.model,
                latencyMs,
                inputTokens: null,
                outputTokens: null,
            });
            if (!project) {
                throw new Error('You do not have permission to create a project in this workspace.');
            }
            context.onFinalized({ type: 'created', project });
            return JSON.stringify({ status: 'saved', revision: project.revision });
        },
        {
            name: 'finalize_generation',
            description: 'Saves your finished, validated Motify generation. Call validate_generation first and fix any errors. On a stale-revision conflict this returns { status: "conflict" } instead of saving — tell the user to retry rather than calling this again with the same arguments.',
            schema: motifyGenerationSchema,
        },
    );
}
