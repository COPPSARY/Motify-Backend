import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/server.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'designer@example.com', emailVerified: true, displayName: 'Designer', avatarUrl: null };
const workspaceId = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000003';
const assetId = '00000000-0000-4000-8000-000000000004';

function dependencies() {
  return {
    auth: {} as never, workspaces: {} as never, projects: {} as never,
    sessions: { resolve: vi.fn().mockResolvedValue({ user, csrfToken: 'csrf-token' }) },
    assets: {
      createUpload: vi.fn().mockResolvedValue({ uploadId: assetId, assetId, uploadUrl: `/v1/assets/uploads/${assetId}/content` }),
      upload: vi.fn().mockResolvedValue({ uploaded: true }),
      complete: vi.fn().mockResolvedValue({ id: assetId, state: 'READY' }),
      list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
      get: vi.fn().mockResolvedValue({ id: assetId, state: 'READY' }),
      download: vi.fn(), remove: vi.fn(), attach: vi.fn(), detach: vi.fn(),
    },
  };
}

function authenticated(test: request.Test) {
  return test.set('Cookie', ['motify_session=session']).set('X-CSRF-Token', 'csrf-token');
}

describe('Asset API', () => {
  it('creates, uploads, completes, lists, and attaches private assets', async () => {
    const deps = dependencies();
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const bytes = Buffer.from('png-data');
    const metadata = { fileName: 'product.png', contentType: 'image/png', byteSize: bytes.length, checksum: 'a'.repeat(64) };

    await authenticated(request(app).post(`/v1/workspaces/${workspaceId}/assets/uploads`)).send(metadata).expect(201);
    await authenticated(request(app).put(`/v1/assets/uploads/${assetId}/content`)).set('Content-Type', 'image/png').send(bytes).expect(200);
    await authenticated(request(app).post(`/v1/workspaces/${workspaceId}/assets/uploads/${assetId}/complete`)).send({}).expect(200);
    await authenticated(request(app).get(`/v1/workspaces/${workspaceId}/assets`)).expect(200);
    await authenticated(request(app).post(`/v1/projects/${projectId}/assets`)).send({ assetId }).expect(204);
    await authenticated(request(app).delete(`/v1/projects/${projectId}/assets/${assetId}`)).expect(204);

    expect(deps.assets.upload).toHaveBeenCalledWith(user.id, assetId, expect.objectContaining({ pipe: expect.any(Function) }), 'image/png');
    expect(deps.assets.complete).toHaveBeenCalledWith(user.id, workspaceId, assetId);
    expect(deps.assets.attach).toHaveBeenCalledWith(user.id, projectId, assetId);
  });

  it('rejects invalid asset metadata and missing CSRF', async () => {
    const deps = dependencies();
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const invalid = await authenticated(request(app).post(`/v1/workspaces/${workspaceId}/assets/uploads`)).send({
      fileName: 'file.exe', contentType: 'application/x-msdownload', byteSize: 1, checksum: 'bad',
    });
    const noCsrf = await request(app).post(`/v1/workspaces/${workspaceId}/assets/uploads`)
      .set('Cookie', ['motify_session=session']).send({ fileName: 'x.png', contentType: 'image/png', byteSize: 1, checksum: 'a'.repeat(64) });
    expect(invalid.status).toBe(400);
    expect(noCsrf.status).toBe(403);
  });
});
