import type { AuthIdentity, AuthProvider, ProviderSession } from '../../packages/auth/types.js';
import { AppError } from '../errors.js';
import { randomBytes } from 'node:crypto';

export interface AccountProvisioner {
  provision(identity: AuthIdentity): Promise<void>;
  existsByEmail?(email: string): Promise<boolean>;
}

export interface SessionCreator {
  create(
    userId: string,
    accessToken: string,
    refreshToken: string,
    providerExpiresAt: Date,
  ): Promise<{ sessionToken: string; csrfToken: string }>;
  revoke(sessionToken: string): Promise<void>;
}

export interface AuthFlowStore {
  create(attemptToken: string, flowState: string): Promise<void>;
  consume(attemptToken: string): Promise<string | null>;
}

/**
 * What an in-flight sign-in has to remember: the provider's PKCE verifier, and
 * where the user was when they started. Motify has two front ends — the site
 * and the editor — and a prompt held in the editor is only worth anything if
 * the round trip ends back there.
 *
 * It travels as one opaque string through the flow store, which encrypts it.
 */
interface AuthFlow {
  verifierState: string;
  returnTo?: string;
}

function encodeFlow(flow: AuthFlow): string {
  return JSON.stringify(flow);
}

function decodeFlow(stored: string): AuthFlow {
  try {
    const parsed = JSON.parse(stored) as Partial<AuthFlow>;
    if (typeof parsed?.verifierState === 'string') {
      return parsed.returnTo ? { verifierState: parsed.verifierState, returnTo: parsed.returnTo } : { verifierState: parsed.verifierState };
    }
  } catch {
    // An attempt started before flows carried a return URL is a bare verifier.
  }
  return { verifierState: stored };
}

interface AuthServiceOptions {
  emailVerificationRedirect: string;
  oauthCallbackUrl: string;
}

export class AuthService {
  constructor(
    private readonly provider: AuthProvider,
    private readonly accounts: AccountProvisioner,
    private readonly sessions: SessionCreator,
    private readonly flows?: AuthFlowStore,
    private readonly options?: AuthServiceOptions,
  ) {}

  async signUpWithEmail(email: string, password: string, returnTo?: string) {
    if (!this.options || !this.flows) throw new Error('Auth service redirect URLs are not configured');
    const normalizedEmail = email.trim().toLowerCase();
    if (await this.accounts.existsByEmail?.(normalizedEmail)) {
      throw new AppError(409, 'ACCOUNT_ALREADY_EXISTS', 'This account already exists. Please log in.');
    }
    const attempt = randomBytes(32).toString('base64url');
    const separator = this.options.emailVerificationRedirect.includes('?') ? '&' : '?';
    const redirectTo = `${this.options.emailVerificationRedirect}${separator}attempt=${encodeURIComponent(attempt)}`;
    const result = await this.provider.signUpWithPassword(normalizedEmail, password, redirectTo);
    await this.flows.create(attempt, encodeFlow({ verifierState: result.verifierState, ...(returnTo ? { returnTo } : {}) }));
    return result;
  }

  async loginWithEmail(email: string, password: string) {
    try {
      return await this.completeLogin(await this.provider.signInWithPassword(email.trim().toLowerCase(), password));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
  }

  async completeEmailVerification(code: string, attempt: string) {
    if (!this.flows) throw new Error('Email verification storage is not configured');
    try {
      const stored = await this.flows.consume(attempt);
      if (!stored) throw new AppError(400, 'EMAIL_VERIFICATION_INVALID', 'The verification link is invalid or expired.');
      const flow = decodeFlow(stored);
      const session = await this.completeLogin(await this.provider.exchangeEmailVerificationCode(code, flow.verifierState));
      return { ...session, ...(flow.returnTo ? { returnTo: flow.returnTo } : {}) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'EMAIL_VERIFICATION_INVALID', 'The verification link is invalid or expired.');
    }
  }

  async completeLogin(providerSession: ProviderSession) {
    if (!providerSession.identity.emailVerified) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');
    }
    await this.accounts.provision(providerSession.identity);
    const session = await this.sessions.create(
      providerSession.identity.id,
      providerSession.accessToken,
      providerSession.refreshToken,
      providerSession.expiresAt,
    );
    return { identity: providerSession.identity, ...session };
  }

  async beginGoogleLogin(returnTo?: string) {
    if (!this.options || !this.flows) throw new Error('OAuth flow storage is not configured');
    const attempt = randomBytes(32).toString('base64url');
    const separator = this.options.oauthCallbackUrl.includes('?') ? '&' : '?';
    const redirectTo = `${this.options.oauthCallbackUrl}${separator}attempt=${encodeURIComponent(attempt)}`;
    const result = await this.provider.getGoogleAuthorizationUrl(redirectTo);
    await this.flows.create(attempt, encodeFlow({ verifierState: result.verifierState, ...(returnTo ? { returnTo } : {}) }));
    return { url: result.url };
  }

  async completeGoogleLogin(code: string, attempt: string) {
    if (!this.flows) throw new Error('OAuth flow storage is not configured');
    const stored = await this.flows.consume(attempt);
    if (!stored) throw new AppError(400, 'OAUTH_ATTEMPT_INVALID', 'The login attempt is invalid or expired.');
    const flow = decodeFlow(stored);
    const session = await this.completeLogin(await this.provider.exchangeCode(code, flow.verifierState));
    return { ...session, ...(flow.returnTo ? { returnTo: flow.returnTo } : {}) };
  }

  async logout(sessionToken: string) {
    await this.sessions.revoke(sessionToken);
  }

}
