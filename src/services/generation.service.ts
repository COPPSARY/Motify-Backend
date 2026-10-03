import type {
    GenerationAudioTrack,
    GraphProjectRepository,
    GraphWorkspaceRole,
    ModelImageInput,
    MotionGraphInput,
    MotionGraphResponse,
} from '../../packages/ai/agent/dependencies.js';
import { ModelProviderError, type ProviderErrorCode } from '../../packages/ai/agent/errors.js';
import { runWithUsageMeter } from '../../packages/ai/usage/usage-meter.js';
import { AppError } from '../errors.js';
import type { GenerationBilling, GenerationCharge } from './generation-billing.js';
import type { RunLock } from './project-run-lock.js';

/** The compiled Motify graph, narrowed to what this service needs. */
export interface MotionGraphRunner {
    invoke(input: MotionGraphInput): Promise<{ response?: MotionGraphResponse | undefined }>;
}

export type ProjectAccessReader = Pick<GraphProjectRepository, 'loadProjectAccess'>;

export interface MessageRequestInput {
    message: string;
    runtimeError?: { message: string } | undefined;
    revision?: number | undefined;
    assets?: AssetAttachmentInput[] | undefined;
    audio?: AudioAttachmentInput[] | undefined;
    frames?: FrameAttachmentInput[] | undefined;
}

export interface AudioAttachmentInput {
    trackId: string;
}

export interface GenerationAudioResolver {
    resolveGenerationAudio(
        userId: string,
        projectId: string,
        audio: readonly AudioAttachmentInput[] | undefined,
    ): Promise<GenerationAudioTrack[]>;
}

export interface AssetAttachmentInput {
    assetId: string;
    role: 'reference' | 'asset';
}

/**
 * A rendered moment of the candidate this message is repairing.
 *
 * This service validates source and never executes it, so it cannot see what
 * a composition actually puts on screen. The editor can, because it mounts the
 * film to judge it, and these are the frames it was looking at. They are the
 * only route by which a fault that lives in the composed result rather than in
 * the source - an object settled half outside the canvas - reaches the model.
 */
export interface FrameAttachmentInput {
    capturedAtSeconds: number;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
}

export interface GenerationAssetResolver {
    resolveGenerationAssets(
        userId: string,
        projectId: string,
        assets: readonly AssetAttachmentInput[] | undefined,
    ): Promise<ModelImageInput[]>;
}

/** What the request cost and what is left, present when credits are being charged. */
interface CreditsField {
    credits?: GenerationCharge;
}

export type MessageResult =
    | ({ type: 'chat'; response: string; projectId?: string; revision?: number } & CreditsField)
    | ({ type: 'generation'; response: string; projectId: string; revision: number } & CreditsField);

const PROVIDER_STATUS: Record<ProviderErrorCode, number> = {
    PROVIDER_RATE_LIMITED: 429,
    PROVIDER_TIMEOUT: 504,
    PROVIDER_UNAVAILABLE: 503,
    PROVIDER_MODEL_UNAVAILABLE: 502,
    PROVIDER_OUTPUT_INVALID: 502,
    PROVIDER_AUTH_FAILED: 502,
    PROVIDER_ERROR: 502,
};

const PROVIDER_MESSAGE: Record<ProviderErrorCode, string> = {
    PROVIDER_RATE_LIMITED: 'Motify is handling too many generations right now. Try again shortly.',
    PROVIDER_TIMEOUT: 'The model took too long to answer. Try again.',
    PROVIDER_UNAVAILABLE: 'The model is temporarily unavailable. Try again shortly.',
    PROVIDER_MODEL_UNAVAILABLE: 'The configured model is unavailable.',
    PROVIDER_OUTPUT_INVALID: 'The model returned an unusable response. Try again.',
    PROVIDER_AUTH_FAILED: 'Motify cannot reach the model right now.',
    PROVIDER_ERROR: 'The generation could not be completed. Try again.',
};

/**
 * Runs one Motify turn against one project. Project access is checked here so a
 * message never reaches the model for a project the caller cannot edit, and every
 * graph outcome becomes an HTTP result.
 */
export class GenerationService {
    constructor(
        private readonly graph: MotionGraphRunner,
        private readonly projects: ProjectAccessReader,
        private readonly assets?: GenerationAssetResolver,
        private readonly audio?: GenerationAudioResolver,
        private readonly billing?: GenerationBilling,
        private readonly runLock?: RunLock,
    ) {}

    async sendMessage(userId: string, projectId: string, input: MessageRequestInput): Promise<MessageResult> {
        const access = await this.projects.loadProjectAccess(projectId, userId);
        if (!access) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        requireWriteAccess(access.role);

        const run = () => this.runMessage(userId, projectId, access, input);
        return this.runLock ? this.runLock(projectId, run) : run();
    }

    private async runMessage(
        userId: string,
        projectId: string,
        access: { workspaceId: string },
        input: MessageRequestInput,
    ): Promise<MessageResult> {
        const supplied = this.assets
            ? await this.assets.resolveGenerationAssets(userId, projectId, input.assets)
            : [];
        // Frames follow the user's own images, and ride the same channel: to
        // every node downstream a frame is one more image with a role, which
        // is all the difference that needs to exist.
        const images = [...supplied, ...toFrameImages(input.frames)];
        const audio = this.audio
            ? await this.audio.resolveGenerationAudio(userId, projectId, input.audio)
            : [];
        const graphInput: MotionGraphInput = {
            userId,
            workspaceId: access.workspaceId,
            projectId,
            message: input.message,
            ...(images.length > 0 ? { assets: images } : {}),
            ...(audio.length > 0 ? { audio } : {}),
            ...(input.runtimeError ? { runtimeError: input.runtimeError } : {}),
            ...(input.revision !== undefined ? { revision: input.revision } : {}),
        };
        if (!this.billing) return this.result(await this.invokeGraph(graphInput));

        // Credits are held before any model is called, so an account that cannot
        // pay never costs a token, and given back if the user gets nothing.
        const hold = await this.billing.begin(userId);
        let result: MessageResult;
        try {
            result = this.result(await runWithUsageMeter(hold.meter, () => this.invokeGraph(graphInput)));
        } catch (error) {
            await this.billing.abandon(hold);
            throw error;
        }
        const credits = await this.billing.complete(hold);
        return credits ? { ...result, credits } : result;
    }

    private result(
        state: { response?: MotionGraphResponse | undefined },
    ): MessageResult {
        const response = state.response;
        if (!response) throw new Error('The Motify graph finished without a response.');
        if (response.type === 'error') throw toAppError(response);
        if (response.type !== 'generation') return { type: response.type, response: response.message };
        return {
            type: 'generation',
            response: response.message,
            projectId: response.projectId,
            revision: response.revision,
        };
    }

    private async invokeGraph(input: MotionGraphInput) {
        try {
            return await this.graph.invoke(input);
        } catch (error) {
            if (error instanceof ModelProviderError) {
                throw new AppError(
                    PROVIDER_STATUS[error.code],
                    error.code,
                    PROVIDER_MESSAGE[error.code],
                    undefined,
                    {
                        provider: error.provider ?? providerName(error.message),
                        ...(error.diagnostics?.httpStatus !== undefined ? { httpStatus: error.diagnostics.httpStatus } : {}),
                        ...(error.diagnostics?.providerCode ? { providerCode: error.diagnostics.providerCode } : {}),
                        ...(error.diagnostics?.providerType ? { providerType: error.diagnostics.providerType } : {}),
                        ...(error.diagnostics?.cause ? { cause: error.diagnostics.cause } : {}),
                    },
                );
            }
            throw error;
        }
    }
}

/**
 * Frames as the model sees them.
 *
 * They carry no stored asset, so the id is positional and the name says what
 * the thing is. Neither is shown to the model for a frame - the prompt names
 * the moment instead - but both keep a frame a well formed image everywhere
 * an image is handled.
 */
function toFrameImages(frames: readonly FrameAttachmentInput[] | undefined): ModelImageInput[] {
    return (frames ?? []).map((frame, index) => ({
        assetId: `frame-${index}`,
        fileName: `frame-${frame.capturedAtSeconds.toFixed(2)}s`,
        mediaType: frame.mediaType,
        dataBase64: frame.dataBase64,
        role: 'frame' as const,
        capturedAtSeconds: frame.capturedAtSeconds,
    }));
}

function providerName(message: string): string {
    return message.split(' ', 1)[0] ?? 'unknown';
}

function requireWriteAccess(role: GraphWorkspaceRole): void {
    if (role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.');
}

function toAppError(response: Extract<MotionGraphResponse, { type: 'error' }>): AppError {
    switch (response.code) {
        case 'PROJECT_NOT_FOUND':
            return new AppError(404, response.code, response.message);
        case 'FORBIDDEN':
            return new AppError(403, response.code, response.message);
        case 'REVISION_CONFLICT':
            return new AppError(409, response.code, response.message, { currentRevision: response.currentRevision });
        case 'GENERATION_INVALID':
            return new AppError(422, response.code, response.message, { errors: response.errors });
    }
}
