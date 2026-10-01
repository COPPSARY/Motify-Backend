import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import { createApp } from '../../src/server.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'designer@example.com', emailVerified: true, displayName: 'Designer', avatarUrl: null };
const workspaceId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000004';

function dependencies() {
  return {
    auth: {} as never, workspaces: {} as never, projects: {} as never,
    sessions: { resolve: vi.fn().mockResolvedValue({ user, csrfToken: 'csrf-token' }) },
    brand: {
      get: vi.fn().mockResolvedValue({ workspaceId, revision: 0 }),
      update: vi.fn().mockResolvedValue({ workspaceId, revision: 1 }),
      addAsset: vi.fn().mockResolvedValue({ workspaceId, revision: 1 }),
      updateAsset: vi.fn().mockResolvedValue({ workspaceId, revision: 1 }),
      removeAsset: vi.fn(),
    },
  };
}

function authenticated(test: request.Test) {
  return test.set('Cookie', ['motify_session=session']).set('X-CSRF-Token', 'csrf-token');
}

function app(deps = dependencies()) {
  return createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
}

describe('Brand DNA API', () => {
  it('reads, saves and manages brand images', async () => {
    const deps = dependencies();
    const server = app(deps);
    const base = `/v1/workspaces/${workspaceId}/brand`;

    await authenticated(request(server).get(base)).expect(200, { data: { workspaceId, revision: 0 } });
    await authenticated(request(server).put(base)).send({
      revision: 0,
      dna: { identity: { name: 'Acme', websiteUrl: 'acme.com' }, visual: { fonts: [{ id: 'f', family: 'Inter', role: 'heading' }] } },
    }).expect(200);
    await authenticated(request(server).post(`${base}/assets`)).send({ assetId, role: 'logo' }).expect(201);
    await authenticated(request(server).patch(`${base}/assets/${assetId}`)).send({ label: '  ' }).expect(200);
    await authenticated(request(server).delete(`${base}/assets/${assetId}`)).expect(204);

    expect(deps.brand.update).toHaveBeenCalledWith(user.id, workspaceId, expect.objectContaining({
      revision: 0,
      dna: expect.objectContaining({
        identity: { name: 'Acme', websiteUrl: 'https://acme.com', tagline: '' },
        visual: { colors: [], fonts: [{ id: 'f', family: 'Inter', role: 'heading', source: 'preset', files: [] }] },
      }),
    }));
    expect(deps.brand.addAsset).toHaveBeenCalledWith(user.id, workspaceId, { assetId, role: 'logo' });
    expect(deps.brand.updateAsset).toHaveBeenCalledWith(user.id, workspaceId, assetId, { label: null });
    expect(deps.brand.removeAsset).toHaveBeenCalledWith(user.id, workspaceId, assetId);
  });

  it('validates input and requires CSRF and a session', async () => {
    const server = app();
    const base = `/v1/workspaces/${workspaceId}/brand`;

    await authenticated(request(server).put(base)).send({ dna: {} }).expect(400);
    await authenticated(request(server).put(base)).send({ revision: 0, dna: { visual: { colors: [{ id: 'a', hex: 'blue' }] } } }).expect(400);
    await authenticated(request(server).put(base)).send({ revision: 0, dna: { secret: true } }).expect(400);
    await authenticated(request(server).put(base)).send({ revision: 0, dna: { video: { aspectRatio: '9:16' } } }).expect(400);
    await authenticated(request(server).post(`${base}/assets`)).send({ assetId, role: 'wallpaper' }).expect(400);
    await authenticated(request(server).patch(`${base}/assets/${assetId}`)).send({}).expect(400);
    await request(server).put(base).set('Cookie', ['motify_session=session']).send({ revision: 0, dna: {} }).expect(403);
  });

  it('surfaces a revision conflict with the current revision', async () => {
    const deps = dependencies();
    deps.brand.update.mockRejectedValue(new AppError(409, 'BRAND_REVISION_CONFLICT', 'Changed.', { currentRevision: 4 }));

    const response = await authenticated(request(app(deps)).put(`/v1/workspaces/${workspaceId}/brand`)).send({ revision: 3, dna: {} });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'BRAND_REVISION_CONFLICT', details: { currentRevision: 4 } });
  });
});
