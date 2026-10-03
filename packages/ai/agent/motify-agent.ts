import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { CompositeBackend, FilesystemBackend, StateBackend, createDeepAgent } from 'deepagents';
import { GraphRecursionError } from '@langchain/langgraph';

import {
    resolveMotifyAgentDependencies,
    type MotifyAgentDependencies,
    type MotionGraphInput,
    type MotionGraphResponse,
    type ModelImageInput,
    type GenerationAudioTrack,
} from './dependencies.js';
import { ModelProviderError, normalizeProviderError } from './errors.js';
import { motifyGenerationDraftSchema, type MotifyGenerationDraft } from './generation-schema.js';
import { validateMotifyGeneration, type ValidationError } from '../validation/generation-validator.js';
import { buildMotifySystemPrompt } from './system-prompt.js';
import { createFinalizeGenerationTool, type FinalizeOutcome } from './tools/finalize-generation.tool.js';
import { createSearchAudioLibraryTool } from './tools/search-audio-library.tool.js';
import { createValidateGenerationTool } from './tools/validate-generation.tool.js';
import { currentUsageTokens } from '../usage/usage-meter.js';
import { MotifyUsageCallbackHandler } from './usage-callback.js';
import { completeGeneration, readWorkspaceFiles } from './workspace-generation.js';

export interface MotionGraphRunner {
    invoke(input: MotionGraphInput): Promise<{ response?: MotionGraphResponse }>;
}

/**
 * Replaces `createMotionGraph` (the old LangGraph pipeline) with an
 * autonomous Deep Agent (spec §3.1-§3.2). Returns the exact interface
 * `GenerationService` already depends on, so the service, controller, and
 * routes are untouched by this migration.
 */
export function createMotifyAgentRunner(dependencies: MotifyAgentDependencies): MotionGraphRunner {
    const resolved = resolveMotifyAgentDependencies(dependencies);
    const modelName = describeModel(resolved.model);

    const run = async (input: MotionGraphInput): Promise<{ response?: MotionGraphResponse }> => {
        const startedAtMs = resolved.now();

        let existing: { title: string; duration: number; width: number; height: number; fps: number; scenes: unknown; compositionHtml: string; timelineJs: string; revision: number } | undefined;
        if (input.projectId !== undefined) {
            const loaded = await resolved.repository.loadForGraph(input.projectId, input.userId);
            if (!loaded) return { response: { type: 'error', code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } };
            if (loaded.project.workspaceId !== input.workspaceId) {
                return { response: { type: 'error', code: 'FORBIDDEN', message: 'This project does not belong to that workspace.' } };
            }
            existing = loaded.project;
        }

        // Every request starts a fresh run from the saved chat history.
        const history = input.projectId !== undefined
            ? await resolved.repository.listRecentMessages(input.projectId, resolved.historyLimit)
            : [];

        // `overwriteForGraph` only appends the assistant's reply to history
        // (see its doc comment); the user's turn on an edit/fix must be
        // persisted here, mirroring what `createForGraph` already does for
        // a brand-new project's first message.
        if (existing && input.projectId !== undefined) {
            const messageAssets = (input.assets ?? [])
                .filter((image) => image.role === 'asset' || image.role === 'reference')
                .map((image) => ({
                    assetId: image.assetId,
                    role: image.role === 'asset' ? 'ASSET' as const : 'REFERENCE' as const,
                }));
            await resolved.repository.appendMessage({
                projectId: input.projectId,
                userId: input.userId,
                role: 'user',
                content: input.message,
                ...(messageAssets.length > 0 ? { assets: messageAssets } : {}),
            });
        }

        let finalized: FinalizeOutcome | undefined;
        let finalizedReply: string | undefined;
        const expectedRevision = input.revision ?? existing?.revision;
        const rawFinalizeTool = createFinalizeGenerationTool({
            repository: resolved.repository,
            userId: input.userId,
            workspaceId: input.workspaceId,
            message: input.message,
            model: modelName,
            now: resolved.now,
            startedAtMs,
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            ...(expectedRevision !== undefined ? { expectedRevision } : {}),
            isFix: input.runtimeError !== undefined,
            onFinalized: (outcome) => { finalized = outcome; },
        });
        const requiredAssetTokens = (input.assets ?? [])
            .filter((image) => image.role === 'asset')
            .map((image) => `motify-asset://${image.assetId}`);
        const requiredAudioTokens = (input.audio ?? [])
            .map((track) => `motify-audio://${track.trackId}`);

        // The agent may fix a film that fails validation, but only so many times: after the first
        // attempt and `maxValidationRetries` retries the run is cut off, instead of spending tokens on a
        // loop it is not escaping. Every failed validate_generation or finalize_generation counts.
        const stopRun = new AbortController();
        let validationFailures = 0;
        let lastValidationErrors: ValidationError[] = [];
        let gaveUpOnValidation = false;
        const noteValidationFailure = (errors: ValidationError[]): void => {
            validationFailures += 1;
            lastValidationErrors = errors;
            if (validationFailures > resolved.maxValidationRetries) {
                gaveUpOnValidation = true;
                stopRun.abort();
            }
        };

        // Wraps the real finalize_generation tool to capture the model's
        // already-Zod-validated `reply` at call time (see `MotifyGeneration`),
        // so the final response never has to re-derive text from the agent's
        // raw last message.
        const finalizeTool = tool(
            async (toolInput: MotifyGenerationDraft) => {
                // The film's two large files come from the agent's workspace when the
                // call leaves them out, so the agent writes them once, not again here.
                const completed = completeGeneration(toolInput, readWorkspaceFiles());
                if (!completed.ok) {
                    noteValidationFailure(completed.missing.map((field) => ({ code: 'DRAFT_MISSING', message: completed.message, field })));
                    return JSON.stringify({ status: 'error', message: completed.message });
                }
                // A second finalize_generation call within the same run, after the first
                // already succeeded, must not hit the repository again: it would reuse the
                // stale `expectedRevision`, get a conflict from the already-saved revision,
                // and overwrite the earlier success in `finalized`. An identical repeat is the
                // same save. A changed one was NOT saved, and saying "saved" would be false.
                if (finalized && finalized.type !== 'conflict') {
                    const sameFilm = completed.generation.compositionHtml === finalized.project.compositionHtml
                        && completed.generation.timelineJs === finalized.project.timelineJs;
                    if (sameFilm) return JSON.stringify({ status: 'saved', revision: finalized.project.revision });
                    return JSON.stringify({
                        status: 'error',
                        message: `Already saved as revision ${finalized.project.revision} earlier in this run, so this call was ignored and the changes in it were not saved. Do not call finalize_generation again. Tell the user the film was saved, and that anything changed after that was not.`,
                    });
                }
                // The workspace starts as the saved project. Saving it back untouched
                // would report success for work that never happened, so a call that
                // leaves the content out must come with files the agent actually changed.
                const leftContentOut = toolInput.compositionHtml === undefined && toolInput.timelineJs === undefined;
                if (leftContentOut && existing
                    && completed.generation.compositionHtml === existing.compositionHtml
                    && completed.generation.timelineJs === existing.timelineJs) {
                    const unchangedMessage = 'Your /composition.html and /timeline.js are unchanged from the saved project, so there is nothing new to save. Edit them with edit_file or write_file first, or pass compositionHtml and timelineJs in this call if you really mean to save them as they are.';
                    noteValidationFailure([{ code: 'DRAFT_UNCHANGED', message: unchangedMessage, field: 'generation' }]);
                    return JSON.stringify({ status: 'error', message: unchangedMessage });
                }
                // Validation is a gate, not advice: a film with broken HTML or JS, or one that leaves
                // out an image or audio track the user attached, must never become a saved revision.
                const report = validateMotifyGeneration(completed.generation, { requiredAssetTokens, requiredAudioTokens });
                if (report.errors.length > 0) {
                    noteValidationFailure(report.errors);
                    return JSON.stringify({
                        status: 'error',
                        message: 'Not saved: the film has errors. Fix them and call finalize_generation again.',
                        errors: report.errors,
                    });
                }
                finalizedReply = completed.generation.reply;
                return rawFinalizeTool.invoke(completed.generation);
            },
            {
                name: 'finalize_generation',
                description: rawFinalizeTool.description,
                schema: motifyGenerationDraftSchema,
            },
        );

        const audioSearch = resolved.audioSearch;
        const tools: StructuredToolInterface[] = [
            createValidateGenerationTool({
                requiredAssetTokens,
                requiredAudioTokens,
                onReport: (report) => { if (report.errors.length > 0) noteValidationFailure(report.errors); },
            }),
            finalizeTool,
            ...(audioSearch
                ? [createSearchAudioLibraryTool((query) => audioSearch(input.userId, input.workspaceId, query))]
                : []),
            ...resolved.mcpTools,
        ];

        const backend = new CompositeBackend(new StateBackend(), {
            '/skills/': new FilesystemBackend({ rootDir: resolved.skillsRoot, virtualMode: true }),
        });

        const agent = createDeepAgent({
            model: resolved.model,
            systemPrompt: buildMotifySystemPrompt(),
            tools,
            backend,
            skills: ['/skills/'],
            permissions: [{ operations: ['write'], paths: ['/skills/**'], mode: 'deny' }],
        });

        const seededFiles = existing ? seedProjectFiles(existing) : {};

        // Ends the run with an error response: the turn is rolled back and the failed run recorded.
        const giveUp = async (response: MotionGraphResponse): Promise<{ response: MotionGraphResponse }> => {
            if (input.projectId !== undefined) {
                try {
                    await resolved.repository.recordRun({
                        projectId: input.projectId,
                        baseRevision: existing?.revision ?? 0,
                        savedRevision: null,
                        status: 'FAILED',
                        model: modelName,
                        latencyMs: resolved.now() - startedAtMs,
                        ...currentUsageTokens(),
                        isFix: input.runtimeError !== undefined,
                    });
                } catch {
                    // A failure to record the failed run must not itself
                    // turn a legitimate 422 into an unhandled 500.
                }
            }
            return { response };
        };
        const validationGaveUp = (): MotionGraphResponse => ({
            type: 'error',
            code: 'GENERATION_INVALID',
            message: `The film still had errors after ${validationFailures} attempts, so it was not saved.`,
            errors: lastValidationErrors.slice(0, 20),
        });

        try {
            const result = await agent.invoke(
                { messages: buildMessages(history, input), files: seededFiles },
                { recursionLimit: resolved.maxSteps, signal: stopRun.signal, callbacks: [new MotifyUsageCallbackHandler()] },
            );

            const finalizedResponse = finalized ? buildFinalizedResponse(finalized, finalizedReply, existing?.revision) : undefined;
            if (finalizedResponse) {
                await recordSavedRunUsage(resolved.repository, finalized);
                return { response: finalizedResponse };
            }

            if (gaveUpOnValidation) return giveUp(validationGaveUp());

            const chatMessage = lastMessageText(result);
            if (chatMessage.trim() === '') {
                // Nothing to show the user, and nothing worth storing as the assistant's reply. Not retryable:
                // the empty turn is finished, so the next attempt must run fresh instead of resuming it.
                throw new ModelProviderError('PROVIDER_OUTPUT_INVALID', `${resolved.providerName} returned an empty reply.`, false, undefined, resolved.providerName);
            }
            // The user's turn on an existing project was already persisted
            // above; a plain-chat reply (no finalize_generation call) must
            // be persisted too, or the conversation history is left with an
            // orphaned, unanswered user turn.
            if (existing && input.projectId !== undefined) {
                await resolved.repository.appendMessage({
                    projectId: input.projectId,
                    userId: input.userId,
                    role: 'assistant',
                    content: chatMessage,
                });
            }
            return { response: { type: 'chat', message: chatMessage } };
        } catch (error) {
            if (gaveUpOnValidation) {
                // The run was cut off on purpose. A film saved before that still counts as a success.
                const savedResponse = finalized ? buildFinalizedResponse(finalized, finalizedReply, existing?.revision) : undefined;
                if (savedResponse) {
                    await recordSavedRunUsage(resolved.repository, finalized);
                    return { response: savedResponse };
                }
                return giveUp(validationGaveUp());
            }
            if (error instanceof GraphRecursionError) {
                // The agent may have successfully called finalize_generation
                // on an earlier step and only run out of budget on some later,
                // inconsequential step — that is a success, not a failure.
                const finalizedResponse = finalized ? buildFinalizedResponse(finalized, finalizedReply, existing?.revision) : undefined;
                if (finalizedResponse) {
                    await recordSavedRunUsage(resolved.repository, finalized);
                    return { response: finalizedResponse };
                }

                return giveUp({
                    type: 'error',
                    code: 'GENERATION_INVALID',
                    message: 'The agent could not finish this generation within its step budget.',
                    errors: [{ code: 'STEP_BUDGET_EXHAUSTED', message: 'No finalize_generation call was made before the step budget ran out.', field: 'generation' }],
                });
            }
            // Any other failure (rate limit, auth, timeout, upstream 5xx,
            // ...) thrown from inside agent.invoke() must not surface as a
            // raw/generic error — normalize it into a ModelProviderError
            // with the right code so it maps to a proper HTTP status
            // upstream instead of a generic 500.
            const normalized = normalizeProviderError(resolved.providerName, error);
            // The project was already saved before the failure (e.g. the closing
            // reply call failed): that is a success for the user, and the turn is complete.
            const savedResponse = finalized ? buildFinalizedResponse(finalized, finalizedReply, existing?.revision) : undefined;
            if (savedResponse) {
                await recordSavedRunUsage(resolved.repository, finalized);
                return { response: savedResponse };
            }
            throw normalized;
        }
    };

    return { invoke: (input) => run(input) };
}

/**
 * `finalize_generation` saves the run row before the agent's last model call, so
 * its token columns are written here once the whole run's usage is known. A
 * failure to do so must not turn a saved generation into an error.
 */
async function recordSavedRunUsage(
    repository: { recordRunUsage: MotifyAgentDependencies['repository']['recordRunUsage'] },
    finalized: FinalizeOutcome | undefined,
): Promise<void> {
    if (!finalized || finalized.type === 'conflict') return;
    try {
        await repository.recordRunUsage({
            projectId: finalized.project.id,
            savedRevision: finalized.project.revision,
            ...currentUsageTokens(),
        });
    } catch {
        // Usage bookkeeping is best-effort; the film is already saved.
    }
}

/**
 * Persistence for a successful (or conflicting) finalize already happened
 * inside `createForGraph`/`overwriteForGraph` themselves (see the doc comment
 * on `GraphProjectRepository`), so this only translates the outcome the tool
 * already recorded into the response shape — it must not write anything.
 */
function buildFinalizedResponse(
    finalized: FinalizeOutcome,
    reply: string | undefined,
    existingRevision: number | undefined,
): MotionGraphResponse | undefined {
    if (finalized.type !== 'conflict') {
        return {
            type: 'generation',
            message: reply ?? '',
            projectId: finalized.project.id,
            revision: finalized.project.revision,
            created: finalized.type === 'created',
        };
    }
    if (existingRevision !== undefined) {
        return { type: 'error', code: 'REVISION_CONFLICT', message: 'The project changed since you loaded it.', currentRevision: existingRevision };
    }
    return undefined;
}

function describeModel(model: MotifyAgentDependencies['model']): string {
    const named = model as unknown as { model?: string; modelName?: string };
    return named.model ?? named.modelName ?? 'unknown';
}

function seedProjectFiles(project: { title: string; duration: number; width: number; height: number; fps: number; scenes: unknown; compositionHtml: string; timelineJs: string }): Record<string, { content: string; mimeType: string; created_at: string; modified_at: string }> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify({ title: project.title, duration: project.duration, width: project.width, height: project.height, fps: project.fps, scenes: project.scenes }, null, 2);
    return {
        '/composition.html': { content: project.compositionHtml, mimeType: 'text/html', created_at: now, modified_at: now },
        '/timeline.js': { content: project.timelineJs, mimeType: 'text/javascript', created_at: now, modified_at: now },
        '/metadata.json': { content: metadata, mimeType: 'application/json', created_at: now, modified_at: now },
    };
}

function buildMessages(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    input: MotionGraphInput,
): Array<HumanMessage | AIMessage> {
    // A user message already saved with the same text as this request (a retry of it, or this very
    // request saved earlier in the run) is not an earlier message; repeating it would only confuse.
    const earlier = [...history];
    while (earlier.at(-1)?.role === 'user' && earlier.at(-1)?.content === input.message) earlier.pop();
    const { turns, unanswered } = normalizeHistory(earlier);
    const messages: Array<HumanMessage | AIMessage> = turns.map((turn) => (
        turn.role === 'user' ? new HumanMessage(turn.text) : new AIMessage(turn.text)
    ));
    const parts: string[] = [
        unanswered === undefined
            ? input.message
            : `Earlier messages of yours that did not get a reply:\n${unanswered}\n\nCurrent message:\n${input.message}`,
    ];
    if (input.runtimeError) parts.push(`Runtime error report: ${input.runtimeError.message}`);
    const assetsSection = describeAssetsSection(input.assets ?? []);
    if (assetsSection) parts.push(assetsSection);
    const audioSection = describeAudioSection(input.audio ?? []);
    if (audioSection) parts.push(audioSection);
    const content = buildUserContent(parts.join('\n\n'), input.assets ?? []);
    messages.push(new HumanMessage({ content }));
    return messages;
}

/**
 * The saved chat is a record of what was said, not a valid conversation: a failed attempt leaves
 * the user's message with no reply (so several in a row), and a window of the most recent rows can
 * begin with an assistant message. Providers reject that ("messages.0.role is invalid"), so it is
 * reshaped to start with the user and alternate. Runs of the same role are joined, a leading
 * assistant message (its question is outside the window) is dropped, and user messages at the end
 * that never got a reply are returned separately, to travel with the new request.
 */
function normalizeHistory(history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>): {
    turns: Array<{ role: 'user' | 'assistant'; text: string }>;
    unanswered: string | undefined;
} {
    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const entry of history) {
        const last = turns.at(-1);
        if (last && last.role === entry.role) last.text = `${last.text}\n\n${entry.content}`;
        else turns.push({ role: entry.role, text: entry.content });
    }
    while (turns[0]?.role === 'assistant') turns.shift();
    const unanswered = turns.at(-1)?.role === 'user' ? turns.pop()?.text : undefined;
    return { turns, unanswered };
}

/** Tells the model each attached image's role, filename, and placement token. */
function describeAssetsSection(images: readonly ModelImageInput[]): string | undefined {
    if (images.length === 0) return undefined;
    const lines = images.map((image) => {
        if (image.role === 'frame') {
            const at = image.capturedAtSeconds !== undefined ? ` captured at ${image.capturedAtSeconds}s` : '';
            return `- ${image.fileName} (frame${at}): a rendering of the current candidate, for you to diagnose. Do not reproduce it.`;
        }
        const token = `motify-asset://${image.assetId}`;
        const roleLabel = image.role === 'asset' ? 'asset to place in the film' : 'reference to imitate';
        return `- ${image.fileName} (${roleLabel}): ${token}`;
    });
    return ['Attached images:', ...lines].join('\n');
}

/** Tells the model each available audio track's metadata and placement token. */
function describeAudioSection(tracks: readonly GenerationAudioTrack[]): string | undefined {
    if (tracks.length === 0) return undefined;
    const lines = tracks.map((track) => {
        const token = `motify-audio://${track.trackId}`;
        const artist = track.artist ? ` by ${track.artist}` : '';
        const genre = track.genre ? `, ${track.genre}` : '';
        const bpm = track.bpm !== null ? `, ${track.bpm} bpm` : '';
        const durationSeconds = Math.round(track.durationMs / 1000);
        return `- ${track.title}${artist}${genre}${bpm}, ${durationSeconds}s: ${token}`;
    });
    return ['Attached audio tracks:', ...lines].join('\n');
}

type MessageContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

function buildUserContent(text: string, images: readonly ModelImageInput[]): string | MessageContentPart[] {
    if (images.length === 0) return text;
    return [
        { type: 'text', text },
        ...images.map((image): MessageContentPart => ({
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
        })),
    ];
}

/** Only used for the plain-chat path; a finalized generation uses its own validated `reply` instead (see `buildFinalizedResponse`). */
function lastMessageText(result: { messages?: Array<{ content: unknown }> }): string {
    const last = result.messages?.at(-1);
    if (!last) return '';
    if (typeof last.content === 'string') return last.content;
    if (Array.isArray(last.content)) {
        return last.content
            .filter((part): part is { type: 'text'; text: string } => (
                typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string'
            ))
            .map((part) => part.text)
            .join('\n');
    }
    return JSON.stringify(last.content);
}
