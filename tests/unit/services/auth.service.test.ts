import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../src/services/auth.service.js';

const identity = { id: '00000000-0000-4000-8000-000000000001', email: 'designer@example.com', emailVerified: true, displayName: 'Designer', avatarUrl: null };
const session = { identity, accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date('2030-01-01T00:00:00.000Z') };

describe('AuthService Supabase email authentication', () => {
  it('tells a user with an existing verified account to log in', async () => {
    const provider = { signUpWithPassword: vi.fn(), signInWithPassword: vi.fn(), exchangeEmailVerificationCode: vi.fn(), getGoogleAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), revokeSession: vi.fn() };
    const accounts = { provision: vi.fn(), existsByEmail: vi.fn().mockResolvedValue(true) };
    const service = new AuthService(provider, accounts, { create: vi.fn(), revoke: vi.fn() }, { create: vi.fn(), consume: vi.fn() }, { emailVerificationRedirect: 'http://localhost:3000/v1/auth/verify', oauthCallbackUrl: 'http://localhost:3000/v1/auth/callback' });

    await expect(service.signUpWithEmail('designer@example.com', 'secret123')).rejects.toMatchObject({
      status: 409,
      code: 'ACCOUNT_ALREADY_EXISTS',
      message: 'This account already exists. Please log in.',
    });
    expect(provider.signUpWithPassword).not.toHaveBeenCalled();
  });

  it('asks Supabase to send a code-based confirmation email and stores its PKCE verifier', async () => {
    const provider = { signUpWithPassword: vi.fn().mockResolvedValue({ requiresVerification: true, identity: null, session: null, verifierState: 'pkce-state' }), signInWithPassword: vi.fn(), exchangeEmailVerificationCode: vi.fn(), getGoogleAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), revokeSession: vi.fn() };
    const flows = { create: vi.fn(), consume: vi.fn() };
    const service = new AuthService(provider, { provision: vi.fn() }, { create: vi.fn(), revoke: vi.fn() }, flows, { emailVerificationRedirect: 'http://localhost:3000/v1/auth/verify', oauthCallbackUrl: 'http://localhost:3000/v1/auth/callback' });

    await service.signUpWithEmail(' NEW@EXAMPLE.COM ', 'secret123');

    expect(provider.signUpWithPassword).toHaveBeenCalledWith('new@example.com', 'secret123', expect.stringMatching(/^http:\/\/localhost:3000\/v1\/auth\/verify\?attempt=/));
    expect(flows.create).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ verifierState: 'pkce-state' }));
  });

  it('carries the front end a login started from back through the OAuth round trip', async () => {
    const provider = { signUpWithPassword: vi.fn(), signInWithPassword: vi.fn(), exchangeEmailVerificationCode: vi.fn(), getGoogleAuthorizationUrl: vi.fn().mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth', verifierState: 'pkce-state' }), exchangeCode: vi.fn().mockResolvedValue(session), revokeSession: vi.fn() };
    const sessions = { create: vi.fn().mockResolvedValue({ sessionToken: 'opaque-session', csrfToken: 'csrf-token' }), revoke: vi.fn() };
    let stored = '';
    const flows = { create: vi.fn(async (_attempt: string, flowState: string) => { stored = flowState; }), consume: vi.fn(async () => stored) };
    const service = new AuthService(provider, { provision: vi.fn() }, sessions, flows, { emailVerificationRedirect: 'http://localhost:3000/v1/auth/verify', oauthCallbackUrl: 'http://localhost:3000/v1/auth/callback' });

    await service.beginGoogleLogin('http://localhost:5173/');

    await expect(service.completeGoogleLogin('oauth-code', 'attempt-token')).resolves.toMatchObject({
      sessionToken: 'opaque-session',
      returnTo: 'http://localhost:5173/',
    });
    expect(provider.exchangeCode).toHaveBeenCalledWith('oauth-code', 'pkce-state');
  });

  it('reads an attempt stored before flows carried a return URL as a bare verifier', async () => {
    const provider = { signUpWithPassword: vi.fn(), signInWithPassword: vi.fn(), exchangeEmailVerificationCode: vi.fn(), getGoogleAuthorizationUrl: vi.fn(), exchangeCode: vi.fn().mockResolvedValue(session), revokeSession: vi.fn() };
    const sessions = { create: vi.fn().mockResolvedValue({ sessionToken: 'opaque-session', csrfToken: 'csrf-token' }), revoke: vi.fn() };
    const flows = { create: vi.fn(), consume: vi.fn().mockResolvedValue('pkce-state') };
    const service = new AuthService(provider, { provision: vi.fn() }, sessions, flows);

    const result = await service.completeGoogleLogin('oauth-code', 'attempt-token');

    expect(provider.exchangeCode).toHaveBeenCalledWith('oauth-code', 'pkce-state');
    expect(result.returnTo).toBeUndefined();
  });

  it('creates an application session after Supabase exchanges the email code', async () => {
    const provider = { signUpWithPassword: vi.fn(), signInWithPassword: vi.fn(), exchangeEmailVerificationCode: vi.fn().mockResolvedValue(session), getGoogleAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), revokeSession: vi.fn() };
    const accounts = { provision: vi.fn() };
    const sessions = { create: vi.fn().mockResolvedValue({ sessionToken: 'opaque-session', csrfToken: 'csrf-token' }), revoke: vi.fn() };
    const flows = { create: vi.fn(), consume: vi.fn().mockResolvedValue('pkce-state') };
    const service = new AuthService(provider, accounts, sessions, flows);

    await expect(service.completeEmailVerification('confirmation-code', 'attempt-token')).resolves.toMatchObject({ identity, sessionToken: 'opaque-session' });
    expect(provider.exchangeEmailVerificationCode).toHaveBeenCalledWith('confirmation-code', 'pkce-state');
    expect(accounts.provision).toHaveBeenCalledWith(identity);
  });
});
