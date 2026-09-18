import { describe, expect, it, vi } from 'vitest';

import type { MotionGraphInput, MotionGraphResponse } from '../../../packages/ai/graph/dependencies.js';
import { ModelProviderError } from '../../../packages/ai/providers/model.provider.js';
import type { ValidationError } from '../../../packages/ai/validation/generation-validator.js';
import { AppError } from '../../../src/errors.js';
import { GenerationService } from '../../../src/services/generation.service.js';

const WORKSPACE_ID = '26ce88b5-1a51-4265-913e-203eb3cadbd7';
const PROJECT_ID = '9a4f2e10-7b53-4a1c-9f0d-2c8b6d5e1a33';
const USER_ID = '00000000-0000-4000-8000-000000000001';

interface HarnessOptions {
    role?: 'owner' | 'editor' | 'viewer' | null;
    response?: MotionGraphResponse;
    error?: unknown;
}

function createService(options: HarnessOptions = {}) {
    const role = options.role === undefined ? 'editor' : options.role;
    const projects = {
        loadProjectAccess: vi.fn(async () => (role ? { workspaceId: WORKSPACE_ID, role } : null)),
    };
    const graph = {
        invoke: vi.fn(async (_input: MotionGraphInput) => {
            if (options.error) throw options.error;
            return { response: options.response ?? ({ type: 'chat', message: 'Motify is ready.' } as MotionGraphResponse) };
        }),
    };
    const assets = {
        resolveGenerationAssets: vi.fn(async () => [{
            assetId: '11111111-1111-4111-8111-111111111111', fileName: 'logo.png', mediaType: 'image/png' as const,
            dataBase64: 'aGVsbG8=', role: 'asset' as const,
        }]),
    };
    return { service: new GenerationService(graph, projects, assets), graph, projects, assets };
}

describe('GenerationService', () => {
    it('hides projects the user cannot reach and never calls the model', async () => {
        const { service, graph } = createService({ role: null });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a logo reveal.' }))
            .rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
        expect(graph.invoke).not.toHaveBeenCalled();
    });

    it('rejects viewers before spending a model call', async () => {
        const { service, graph } = createService({ role: 'viewer' });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a logo reveal.' }))
            .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
        expect(graph.invoke).not.toHaveBeenCalled();
    });

    it('returns the conversational reply without project fields', async () => {
        const { service } = createService({ response: { type: 'chat', message: 'What should it say?' } });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Can you help me?' }))
            .resolves.toEqual({ type: 'chat', response: 'What should it say?' });
    });

    it('sends the addressed project and its workspace to the graph', async () => {
        const { service, graph } = createService({
            response: { type: 'generation', message: 'Fixed it.', projectId: PROJECT_ID, revision: 8, created: false },
        });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, {
            message: 'Fix the crash.',
            revision: 7,
            runtimeError: { message: 'buildTimeline is not a function' },
        })).resolves.toEqual({ type: 'generation', response: 'Fixed it.', projectId: PROJECT_ID, revision: 8 });

        expect(graph.invoke).toHaveBeenCalledWith(expect.objectContaining({
            userId: USER_ID,
            workspaceId: WORKSPACE_ID,
            projectId: PROJECT_ID,
            message: 'Fix the crash.',
            revision: 7,
            runtimeError: { message: 'buildTimeline is not a function' },
        }));
    });

    it('omits absent optional fields instead of sending undefined to the graph', async () => {
        const { service, graph } = createService();

        await service.sendMessage(USER_ID, PROJECT_ID, { message: 'Hello' });

        expect(graph.invoke).toHaveBeenCalledWith(expect.objectContaining({
            userId: USER_ID, workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, message: 'Hello',
        }));
    });

    it('resolves role-bearing asset IDs before invoking the graph', async () => {
        const { service, graph, assets } = createService();
        const attachments = [{ assetId: '11111111-1111-4111-8111-111111111111', role: 'asset' as const }];

        await service.sendMessage(USER_ID, PROJECT_ID, { message: 'Use my logo.', assets: attachments });

        expect(assets.resolveGenerationAssets).toHaveBeenCalledWith(USER_ID, PROJECT_ID, attachments);
        expect(graph.invoke).toHaveBeenCalledWith(expect.objectContaining({
            assets: [expect.objectContaining({ fileName: 'logo.png', role: 'asset' })],
        }));
    });

    it('maps a stale revision to a conflict that carries the current revision', async () => {
        const { service } = createService({
            response: { type: 'error', code: 'REVISION_CONFLICT', message: 'Changed.', currentRevision: 9 },
        });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Edit it.', revision: 7 }))
            .rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT', details: { currentRevision: 9 } });
    });

    it('reports validation diagnostics as an unprocessable generation', async () => {
        const errors: ValidationError[] = [{ field: 'timelineJs', code: 'FORBIDDEN_API', message: 'fetch is not allowed.' }];
        const { service } = createService({
            response: { type: 'error', code: 'GENERATION_INVALID', message: 'Invalid.', errors },
        });

        await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Edit it.' }))
            .rejects.toMatchObject({ status: 422, code: 'GENERATION_INVALID', details: { errors } });
    });

    it('maps a missing project and a read-only role reported by the graph', async () => {
        const missing = createService({
            response: { type: 'error', code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
        });
        await expect(missing.service.sendMessage(USER_ID, PROJECT_ID, { message: 'Edit it.' }))
            .rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });

        const forbidden = createService({
            response: { type: 'error', code: 'FORBIDDEN', message: 'Viewer access is read-only.' },
        });
        await expect(forbidden.service.sendMessage(USER_ID, PROJECT_ID, { message: 'Edit it.' }))
            .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it('translates provider failures into retryable HTTP statuses', async () => {
        const limited = createService({
            error: new ModelProviderError('PROVIDER_RATE_LIMITED', 'gemini rate limit reached.', true),
        });
        await expect(limited.service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make it.' }))
            .rejects.toMatchObject({ status: 429, code: 'PROVIDER_RATE_LIMITED' });

        const timedOut = createService({
            error: new ModelProviderError('PROVIDER_TIMEOUT', 'The model request timed out.', false),
        });
        await expect(timedOut.service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make it.' }))
            .rejects.toMatchObject({ status: 504, code: 'PROVIDER_TIMEOUT' });
    });

    it('never leaks the provider key failure message to the client', async () => {
        const { service } = createService({
            error: new ModelProviderError('PROVIDER_AUTH_FAILED', 'gemini rejected the configured API key.', false),
        });

        const failure = await service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make it.' }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(AppError);
        expect((failure as AppError).status).toBe(502);
        expect((failure as AppError).message).not.toContain('API key');
    });

    it('preserves sanitized provider diagnostics for server logs only', async () => {
        const { service } = createService({
            error: new ModelProviderError(
                'PROVIDER_ERROR',
                'anthropic request failed.',
                false,
                {
                    httpStatus: 400,
                    providerCode: 'invalid_request_error',
                    providerType: 'invalid_request_error',
                } as never,
            ),
        });

        const failure = await service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make it.' }).catch((error: unknown) => error);

        expect(failure).toMatchObject({
            status: 502,
            message: 'The generation could not be completed. Try again.',
            logDetails: {
                provider: 'anthropic',
                httpStatus: 400,
                providerCode: 'invalid_request_error',
                providerType: 'invalid_request_error',
            },
        });
    });
});
