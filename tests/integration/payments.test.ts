import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import { createApp } from '../../src/server.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'designer@example.com', emailVerified: true, displayName: 'Designer', avatarUrl: null };
const workspaceId = '00000000-0000-4000-8000-000000000002';
const paymentId = '00000000-0000-4000-8000-000000000003';

function dependencies() {
  return {
    auth: {} as never, workspaces: {} as never, projects: {} as never,
    sessions: { resolve: vi.fn().mockResolvedValue({ user, csrfToken: 'csrf-token' }) },
    payments: {
      listPlans: vi.fn().mockReturnValue([{ id: 'pro', price: 20 }]),
      getSubscription: vi.fn().mockResolvedValue({ status: 'none', plan: null }),
      createCheckout: vi.fn().mockResolvedValue({ id: paymentId, status: 'PENDING', qr: '000201...' }),
      getPayment: vi.fn().mockResolvedValue({ id: paymentId, status: 'PAID', subscription: { status: 'active', plan: 'pro' } }),
    },
  };
}

function authenticated(test: request.Test) {
  return test.set('Cookie', ['motify_session=session']).set('X-CSRF-Token', 'csrf-token');
}

function app(deps = dependencies()) {
  return createApp({ services: deps, frontendOrigins: ['http://localhost:5173'], secureCookies: false });
}

describe('Billing API', () => {
  it('lists plans without a session', async () => {
    await request(app()).get('/v1/billing/plans').expect(200, { data: [{ id: 'pro', price: 20 }] });
  });

  it('creates a checkout, polls it and reads the subscription', async () => {
    const deps = dependencies();
    const server = app(deps);

    await authenticated(request(server).post(`/v1/workspaces/${workspaceId}/billing/payments`)).send({ plan: 'pro' })
      .expect(201, { data: { id: paymentId, status: 'PENDING', qr: '000201...' } });
    const poll = await authenticated(request(server).get(`/v1/payments/${paymentId}`)).expect(200);
    expect(poll.headers['cache-control']).toBe('no-store');
    expect(poll.body.data.subscription.plan).toBe('pro');
    await authenticated(request(server).get(`/v1/workspaces/${workspaceId}/billing/subscription`)).expect(200);

    expect(deps.payments.createCheckout).toHaveBeenCalledWith(user.id, workspaceId, 'pro');
    expect(deps.payments.getPayment).toHaveBeenCalledWith(user.id, paymentId);
    expect(deps.payments.getSubscription).toHaveBeenCalledWith(user.id, workspaceId);
  });

  it('requires a session, CSRF and a known plan', async () => {
    const server = app();

    await request(server).get(`/v1/payments/${paymentId}`).expect(401);
    await request(server).post(`/v1/workspaces/${workspaceId}/billing/payments`).set('Cookie', ['motify_session=session'])
      .send({ plan: 'pro' }).expect(403);
    await authenticated(request(server).post(`/v1/workspaces/${workspaceId}/billing/payments`)).send({ plan: 'enterprise' }).expect(400);
    await authenticated(request(server).get('/v1/payments/not-a-uuid')).expect(400);
  });

  it('surfaces service errors with their code', async () => {
    const deps = dependencies();
    deps.payments.createCheckout.mockRejectedValue(new AppError(409, 'PLAN_UNAVAILABLE', 'This plan cannot be bought yet.'));

    const response = await authenticated(request(app(deps)).post(`/v1/workspaces/${workspaceId}/billing/payments`)).send({ plan: 'studio' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PLAN_UNAVAILABLE');
  });

  it('leaves billing routes unmounted when payments are not configured', async () => {
    const { payments: _payments, ...withoutPayments } = dependencies();
    await request(createApp({ services: withoutPayments, frontendOrigins: ['http://localhost:5173'], secureCookies: false }))
      .get('/v1/billing/plans').expect(404);
  });
});
