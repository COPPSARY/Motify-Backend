import type {
    GraphProjectRepository,
    GraphWorkspaceRole,
    MotionGraphInput,
    MotionGraphResponse,
} from '../../packages/ai/graph/dependencies.js';
import { ModelProviderError, type ProviderErrorCode } from '../../packages/ai/providers/model.provider.js';
import type { ModelImageInput } from '../../packages/ai/providers/model.provider.js';
import { AppError } from '../errors.js';

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
}

export interface AssetAttachmentInput {
    assetId: string;
    role: 'reference' | 'asset';
}

export interface GenerationAssetResolver {
    resolveGenerationAssets(
        userId: string,
        projectId: string,
        assets: readonly AssetAttachmentInput[] | undefined,
    ): Promise<ModelImageInput[]>;
}

export type MessageResult =
    | { type: 'chat'; response: string; projectId?: string; revision?: number }
    | { type: 'plan'; response: string; projectId?: string; revision?: number }
    | { type: 'generation'; response: string; projectId: string; revision: number };

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
    ) {}

    async sendMessage(userId: string, projectId: string, input: MessageRequestInput): Promise<MessageResult> {
        const access = await this.projects.loadProjectAccess(projectId, userId);
        if (!access) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        requireWriteAccess(access.role);

        const images = this.assets
            ? await this.assets.resolveGenerationAssets(userId, projectId, input.assets)
            : [];
        return this.result(await this.invokeGraph({
            userId,
            workspaceId: access.workspaceId,
            projectId,
            message: input.message,
            ...(images.length > 0 ? { assets: images } : {}),
            ...(input.runtimeError ? { runtimeError: input.runtimeError } : {}),
            ...(input.revision !== undefined ? { revision: input.revision } : {}),
        }));
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
                        provider: providerName(error.message),
                        ...(error.diagnostics?.httpStatus !== undefined ? { httpStatus: error.diagnostics.httpStatus } : {}),
                        ...(error.diagnostics?.providerCode ? { providerCode: error.diagnostics.providerCode } : {}),
                        ...(error.diagnostics?.providerType ? { providerType: error.diagnostics.providerType } : {}),
                    },
                );
            }
            throw error;
        }
    }
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
