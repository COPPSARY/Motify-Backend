import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import { createApp } from '../../src/server.js';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'designer@example.com',
  emailVerified: true,
  displayName: 'Motion Designer',
  avatarUrl: null,
};

const session = ['motify_session=opaque'];

function build(options: { signedIn?: boolean; withCredits?: boolean } = {}) {
  const { signedIn = true, withCredits = true } = options;
  const credits = {
    getBalance: vi.fn().mockResolvedValue({ balance: 50 }),
    listHistory: vi.fn().mockResolvedValue({ entries: [], nextCursor: null }),
  };
  const app = createApp({
    services: {
      auth: {
        signUpWithEmail: vi.fn(), loginWithEmail: vi.fn(), beginGoogleLogin: vi.fn(),
        completeGoogleLogin: vi.fn(), completeEmailVerification: vi.fn(), logout: vi.fn(),
      },
      sessions: { resolve: vi.fn().mockResolvedValue(signedIn ? { user, csrfToken: 'csrf-token' } : null) },
      workspaces: {
        list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(),
        listMembers: vi.fn(), addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(),
      },
      projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn() },
      ...(withCredits ? { credits } : {}),
    },
    frontendOrigins: ['http://localhost:5173'],
    secureCookies: false,
  });
  return { app, credits };
}

describe('credits API', () => {
  it('requires a session', async () => {
    const { app, credits } = build({ signedIn: false });
    expect((await request(app).get('/v1/credits')).status).toBe(401);
    expect((await request(app).get('/v1/credits/history')).status).toBe(401);
    expect(credits.getBalance).not.toHaveBeenCalled();
    expect(credits.listHistory).not.toHaveBeenCalled();
  });

  it("returns only the signed-in user's balance, uncached", async () => {
    const { app, credits } = build();
    const response = await request(app).get('/v1/credits').set('Cookie', session);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { balance: 50 } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(credits.getBalance).toHaveBeenCalledWith(user.id);
  });

  it('ignores any user id a client supplies', async () => {
    const { app, credits } = build();
    const victim = '00000000-0000-4000-8000-0000000000ff';

    await request(app).get(`/v1/credits?userId=${victim}`).set('Cookie', session);
    expect(credits.getBalance).toHaveBeenCalledWith(user.id);
    expect(credits.getBalance).not.toHaveBeenCalledWith(victim);

    const history = await request(app).get(`/v1/credits/history?userId=${victim}`).set('Cookie', session);
    expect(history.status).toBe(400);
    expect(credits.listHistory).not.toHaveBeenCalled();

    expect((await request(app).get(`/v1/credits/${victim}`).set('Cookie', session)).status).toBe(404);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'has no way to write credits with %s, even with a valid CSRF token',
    async (method) => {
      const { app, credits } = build();
      for (const path of ['/v1/credits', '/v1/credits/history', '/v1/credits/balance', '/v1/credits/grant', '/v1/credits/adjust']) {
        const response = await request(app)[method](path)
          .set('Cookie', session)
          .set('X-CSRF-Token', 'csrf-token')
          .send({ balance: 999999, amount: 999999, userId: user.id });
        expect(response.status).toBe(404);
      }
      expect(credits.getBalance).not.toHaveBeenCalled();
      expect(credits.listHistory).not.toHaveBeenCalled();
    },
  );

  it('pages history with a bounded limit and passes the cursor through', async () => {
    const { app, credits } = build();
    const ok = await request(app).get('/v1/credits/history?limit=5&cursor=abc').set('Cookie', session);
    expect(ok.status).toBe(200);
    expect(credits.listHistory).toHaveBeenCalledWith(user.id, { limit: 5, cursor: 'abc' });

    await request(app).get('/v1/credits/history').set('Cookie', session);
    expect(credits.listHistory).toHaveBeenLastCalledWith(user.id, { limit: 20 });

    for (const query of ['limit=0', 'limit=51', 'limit=abc', 'limit=1.5', `cursor=${'a'.repeat(301)}`]) {
      const response = await request(app).get(`/v1/credits/history?${query}`).set('Cookie', session);
      expect(response.status, query).toBe(400);
    }
  });

  it('does not add credit routes when the service is not configured', async () => {
    const { app } = build({ withCredits: false });
    expect((await request(app).get('/v1/credits').set('Cookie', session)).status).toBe(404);
  });

  it('answers 402 with the balance when a generation cannot be paid for', async () => {
    const paid = createApp({
      services: {
        auth: {
          signUpWithEmail: vi.fn(), loginWithEmail: vi.fn(), beginGoogleLogin: vi.fn(),
          completeGoogleLogin: vi.fn(), completeEmailVerification: vi.fn(), logout: vi.fn(),
        },
        sessions: { resolve: vi.fn().mockResolvedValue({ user, csrfToken: 'csrf-token' }) },
        workspaces: {
          list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(),
          listMembers: vi.fn(), addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(),
        },
        projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn() },
        motionMessages: {
          sendMessage: vi.fn().mockRejectedValue(
            new AppError(402, 'INSUFFICIENT_CREDITS', 'You do not have enough credits for this request.', { balance: 0.2, required: 0.5 }),
          ),
        },
      },
      frontendOrigins: ['http://localhost:5173'],
      secureCookies: false,
    });
    const response = await request(paid)
      .post('/v1/projects/9a4f2e10-7b53-4a1c-9f0d-2c8b6d5e1a33/messages')
      .set('Cookie', session).set('X-CSRF-Token', 'csrf-token')
      .send({ message: 'Make a film' });
    expect(response.status).toBe(402);
    expect(response.body.error).toMatchObject({ code: 'INSUFFICIENT_CREDITS', details: { balance: 0.2, required: 0.5 } });
  });
});
