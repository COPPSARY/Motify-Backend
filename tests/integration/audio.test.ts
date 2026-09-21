import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import { createApp } from '../../src/server.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'designer@example.com', emailVerified: true, displayName: 'Designer', avatarUrl: null };
const workspaceId = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000003';
const assetId = '00000000-0000-4000-8000-000000000004';
const trackId = '00000000-0000-4000-8000-000000000005';

function dependencies() {
  return {
    auth: {} as never, workspaces: {} as never, projects: {} as never,
    sessions: { resolve: vi.fn().mockResolvedValue({ user, csrfToken: 'csrf-token' }) },
    motionMessages: { sendMessage: vi.fn().mockResolvedValue({ type: 'plan', response: 'Plan only.' }) },
    audio: {
      register: vi.fn().mockResolvedValue({ id: trackId, scope: 'workspace', token: `motify-audio://${trackId}` }),
      list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
      get: vi.fn().mockResolvedValue({ id: trackId }),
      updateMetadata: vi.fn().mockResolvedValue({ id: trackId, bpm: 128 }),
      remove: vi.fn(),
      createAccess: vi.fn().mockResolvedValue({ url: 'https://storage/read', expiresIn: 300 }),
      download: vi.fn().mockResolvedValue({ kind: 'redirect', url: 'https://storage/song', contentType: 'audio/mpeg', fileName: 'song.mp3' }),
      listProjectTracks: vi.fn().mockResolvedValue([{ id: trackId }]),
      detach: vi.fn(),
    },
  };
}

function authenticated(test: request.Test) {
  return test.set('Cookie', ['motify_session=session']).set('X-CSRF-Token', 'csrf-token');
}

function app(deps = dependencies()) {
  return createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
}

describe('Audio library API', () => {
  it('registers, lists, edits, previews, detaches and deletes tracks', async () => {
    const deps = dependencies();
    const server = app(deps);

    await authenticated(request(server).post(`/v1/workspaces/${workspaceId}/audio`))
      .send({ assetId, title: 'Bright Future', bpm: 120, moodTags: ['upbeat'] }).expect(201);
    await authenticated(request(server).get(`/v1/workspaces/${workspaceId}/audio?scope=system&q=upbeat`)).expect(200);
    await authenticated(request(server).get(`/v1/audio/${trackId}`)).expect(200);
    await authenticated(request(server).patch(`/v1/audio/${trackId}`)).send({ bpm: 128, artist: null }).expect(200);
    await authenticated(request(server).get(`/v1/audio/${trackId}/access`)).expect(200, { data: { url: 'https://storage/read', expiresIn: 300 } });
    await authenticated(request(server).get(`/v1/audio/${trackId}/download`)).expect(302).expect('Location', 'https://storage/song');
    await authenticated(request(server).get(`/v1/projects/${projectId}/audio`)).expect(200, { data: [{ id: trackId }] });
    await authenticated(request(server).delete(`/v1/projects/${projectId}/audio/${trackId}`)).expect(204);
    await authenticated(request(server).delete(`/v1/audio/${trackId}`)).expect(204);

    expect(deps.audio.register).toHaveBeenCalledWith(user.id, workspaceId, { assetId, title: 'Bright Future', bpm: 120, moodTags: ['upbeat'] });
    expect(deps.audio.list).toHaveBeenCalledWith(user.id, workspaceId, 'system', 1, 20, 'upbeat');
    expect(deps.audio.updateMetadata).toHaveBeenCalledWith(user.id, trackId, { bpm: 128, artist: null });
    expect(deps.audio.detach).toHaveBeenCalledWith(user.id, projectId, trackId);
  });

  it('validates input and requires CSRF for mutations', async () => {
    const server = app();

    await authenticated(request(server).post(`/v1/workspaces/${workspaceId}/audio`)).send({ assetId, bpm: 1000 }).expect(400);
    await authenticated(request(server).patch(`/v1/audio/${trackId}`)).send({}).expect(400);
    await authenticated(request(server).get(`/v1/workspaces/${workspaceId}/audio?scope=everyone`)).expect(400);
    await request(server).delete(`/v1/audio/${trackId}`).set('Cookie', ['motify_session=session']).expect(403);
  });

  it('surfaces read-only system tracks as a stable error', async () => {
    const deps = dependencies();
    deps.audio.remove.mockRejectedValue(new AppError(403, 'AUDIO_TRACK_READ_ONLY', 'Built-in tracks cannot be changed.'));

    const response = await authenticated(request(app(deps)).delete(`/v1/audio/${trackId}`));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUDIO_TRACK_READ_ONLY');
  });

  it('accepts music tracks on a generation message', async () => {
    const deps = dependencies();
    await authenticated(request(app(deps)).post(`/v1/projects/${projectId}/messages`))
      .send({ message: 'Score it to this song.', audio: [{ trackId }] }).expect(200);
    await authenticated(request(app(deps)).post(`/v1/projects/${projectId}/messages`))
      .send({ message: 'Too many.', audio: ['a', 'b', 'c', 'd'].map(() => ({ trackId })) }).expect(400);

    expect(deps.motionMessages.sendMessage).toHaveBeenCalledWith(user.id, projectId, { message: 'Score it to this song.', audio: [{ trackId }] });
  });
});
