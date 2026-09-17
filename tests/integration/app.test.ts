import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/server.js';

const identity = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'designer@example.com',
  emailVerified: true,
  displayName: 'Motion Designer',
  avatarUrl: null,
};

function dependencies() {
  return {
    auth: {
      signUpWithEmail: vi.fn(),
      loginWithEmail: vi.fn().mockResolvedValue({
        identity,
        sessionToken: 'opaque-session',
        csrfToken: 'csrf-token',
      }),
      beginGoogleLogin: vi.fn(),
      completeGoogleLogin: vi.fn(),
      completeEmailVerification: vi.fn().mockResolvedValue({ identity, sessionToken: 'verified-session', csrfToken: 'verified-csrf' }),
      logout: vi.fn(),
    },
    sessions: {
      resolve: vi.fn().mockResolvedValue(null),
    },
    workspaces: {
      list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(),
      listMembers: vi.fn(), addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(),
    },
    projects: {
      list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(),
    },
    motionMessages: {
      sendMessage: vi.fn().mockResolvedValue({ type: 'plan', response: 'Plan only.' }),
    },
  };
}

describe('Motify API', () => {
  it('reports dependency-aware readiness without exposing the failure', async () => {
    const ready = createApp({
      services: dependencies(), frontendOrigins: ['http://localhost:5173'], secureCookies: false,
      readiness: vi.fn().mockResolvedValue(undefined),
    });
    expect((await request(ready).get('/ready')).body).toEqual({ status: 'ready' });

    const unavailable = createApp({
      services: dependencies(), frontendOrigins: ['http://localhost:5173'], secureCookies: false,
      readiness: vi.fn().mockRejectedValue(new Error('postgresql://secret-host')),
    });
    const response = await request(unavailable).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(response.body)).not.toContain('secret-host');
  });

  it('accepts email registration at the top-level sign-up route', async () => {
    const deps = dependencies();
    const app = createApp({
      services: deps,
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const response = await request(app)
      .post('/v1/auth/sign-up')
      .send({ email: 'NEW@EXAMPLE.COM', password: 'secret123' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ data: { verificationRequired: true } });
    expect(deps.auth.signUpWithEmail).toHaveBeenCalledWith('NEW@EXAMPLE.COM', 'secret123');

    const removedRoute = await request(app)
      .post('/v1/auth/email/sign-up')
      .send({ email: 'new@example.com', password: 'secret123' });
    expect(removedRoute.status).toBe(404);
  });

  it('sets opaque session and CSRF cookies after email login', async () => {
    const deps = dependencies();
    const app = createApp({
      services: deps,
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'DESIGNER@example.com', password: 'secret123' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('designer@example.com');
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('motify_session=opaque-session'),
      expect.stringContaining('motify_csrf=csrf-token'),
    ]));
  });

  it('rejects unauthenticated workspace requests', async () => {
    const app = createApp({
      services: dependencies(),
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const response = await request(app).get('/v1/workspaces');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requires a session-bound CSRF token for mutations', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({
      user: identity,
      csrfToken: 'expected-csrf',
    });
    const app = createApp({
      services: deps,
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const response = await request(app)
      .post('/v1/workspaces')
      .set('Cookie', ['motify_session=opaque-session'])
      .send({ name: 'Studio' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
  });

  it('routes generation through the project messages endpoint', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'expected-csrf' });
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const response = await request(app).post('/v1/projects/26ce88b5-1a51-4265-913e-203eb3cadbd7/messages')
      .set('Cookie', ['motify_session=session']).set('x-csrf-token', 'expected-csrf').send({ message: 'Plan a launch.' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ type: 'plan', response: 'Plan only.' });
    expect(deps.motionMessages.sendMessage).toHaveBeenCalledWith(identity.id, '26ce88b5-1a51-4265-913e-203eb3cadbd7', { message: 'Plan a launch.' });
  });

  it('does not expose workspace-scoped generation', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'expected-csrf' });
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });

    const response = await request(app).post('/v1/generations')
      .set('Cookie', ['motify_session=session']).set('x-csrf-token', 'expected-csrf')
      .send({ workspaceId: '26ce88b5-1a51-4265-913e-203eb3cadbd7', message: 'Create a launch film.' });

    expect(response.status).toBe(404);
  });


  it('lists projects through the workspace projects endpoint', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'expected-csrf' });
    deps.projects.list.mockResolvedValue([{ id: 'project-1', name: 'Launch' }]);
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const response = await request(app).get('/v1/workspaces/26ce88b5-1a51-4265-913e-203eb3cadbd7/projects').set('Cookie', ['motify_session=session']);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 'project-1', name: 'Launch' }]);
    expect(deps.projects.list).toHaveBeenCalledWith(identity.id, '26ce88b5-1a51-4265-913e-203eb3cadbd7');
  });

  it('returns the two renderable files for a project', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'expected-csrf' });
    deps.projects.get.mockResolvedValue({ compositionHtml: '<template><style>.hero { color: red; }</style></template>', timelineJs: 'export function buildTimeline() {}' });
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const response = await request(app).get('/v1/projects/26ce88b5-1a51-4265-913e-203eb3cadbd7/source').set('Cookie', ['motify_session=session']);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      'composition.html': '<template><style>.hero { color: red; }</style></template>',
      'timeline.js': 'export function buildTimeline() {}',
    });
  });

  it('does not expose the removed files endpoint', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'expected-csrf' });
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });

    const response = await request(app)
      .get('/v1/projects/26ce88b5-1a51-4265-913e-203eb3cadbd7/files')
      .set('Cookie', ['motify_session=session']);

    expect(response.status).toBe(404);
  });

  it('returns the session CSRF token with the current user', async () => {
    const deps = dependencies();
    deps.sessions.resolve.mockResolvedValue({ user: identity, csrfToken: 'oauth-csrf' });
    const app = createApp({
      services: deps,
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const response = await request(app)
      .get('/v1/auth/me')
      .set('Cookie', ['motify_session=opaque-session']);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ user: identity, csrfToken: 'oauth-csrf' });
  });

  it('verifies an email token and redirects to the frontend', async () => {
    const deps = dependencies();
    const app = createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
    const response = await request(app).get('/v1/auth/verify').query({ code: '99f472a5-85f7-481d-bd2d-24edc06e02f2', attempt: 'email-attempt' });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173/?verified=true');
    expect(deps.auth.completeEmailVerification).toHaveBeenCalledWith('99f472a5-85f7-481d-bd2d-24edc06e02f2', 'email-attempt');
  });

  it('does not expose the removed email-prefixed login and verification routes', async () => {
    const app = createApp({
      services: dependencies(),
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });

    const loginResponse = await request(app)
      .post('/v1/auth/email/login')
      .send({ email: 'designer@example.com', password: 'secret123' });
    const verifyResponse = await request(app)
      .get('/v1/auth/email/verify')
      .query({ code: '99f472a5-85f7-481d-bd2d-24edc06e02f2' });

    expect(loginResponse.status).toBe(404);
    expect(verifyResponse.status).toBe(404);
  });
});
