import type { Response } from 'express';
import { z } from 'zod';

import { serializeLogError } from '../config/logger.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../middleware/authentication.js';
import { requestLogContext } from '../middleware/request-logger.js';
import type { AuthIdentity } from '../../packages/auth/types.js';
import type { AuthenticatedRequest } from '../types/http.js';

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(128),
  returnTo: z.url().max(2048).optional(),
});

interface CompletedLogin {
  identity: AuthIdentity;
  sessionToken: string;
  csrfToken: string;
  /** Where the flow started, when it began somewhere other than the default front end. */
  returnTo?: string;
}

export interface AuthControllerService {
  signUpWithEmail(email: string, password: string, returnTo?: string): Promise<unknown>;
  loginWithEmail(email: string, password: string): Promise<{ identity: AuthIdentity; sessionToken: string; csrfToken: string }>;
  completeEmailVerification(code: string, attempt: string): Promise<CompletedLogin>;
  beginGoogleLogin(returnTo?: string): Promise<{ url: string }>;
  completeGoogleLogin(code: string, attempt: string): Promise<CompletedLogin>;
  logout(sessionToken: string): Promise<void>;
}

export class AuthController {
  private readonly frontendOrigin: string;

  constructor(
    private readonly auth: AuthControllerService,
    private readonly frontendOrigins: readonly string[],
    private readonly secureCookies: boolean,
    private readonly includeErrorStack: boolean,
  ) {
    const [primary] = frontendOrigins;
    if (!primary) throw new Error('At least one frontend origin is required');
    this.frontendOrigin = primary;
  }

  /**
   * A return URL only ever comes from the browser, so it is honoured only when
   * it points at a front end this deployment serves. Anything else silently
   * falls back to the default origin rather than becoming an open redirect.
   */
  private safeReturnTo(candidate: string | undefined): string | undefined {
    if (!candidate) return undefined;
    try {
      const url = new URL(candidate);
      return this.frontendOrigins.includes(url.origin) ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  signUp = async (request: AuthenticatedRequest, response: Response) => {
    const input = credentialsSchema.parse(request.body);
    await this.auth.signUpWithEmail(input.email, input.password, this.safeReturnTo(input.returnTo));
    response.status(202).json({ data: { verificationRequired: true } });
  };

  login = async (request: AuthenticatedRequest, response: Response) => {
    const input = credentialsSchema.parse(request.body);
    const result = await this.auth.loginWithEmail(input.email, input.password);
    this.setSessionCookies(response, result.sessionToken, result.csrfToken);
    response.json({ data: { user: result.identity, csrfToken: result.csrfToken } });
  };

  verifyEmail = async (request: AuthenticatedRequest, response: Response) => {
    const query = z.object({ code: z.string().uuid(), attempt: z.string().min(1) }).parse(request.query);
    const result = await this.auth.completeEmailVerification(query.code, query.attempt);
    this.setSessionCookies(response, result.sessionToken, result.csrfToken);
    const destination = new URL(this.safeReturnTo(result.returnTo) ?? this.frontendOrigin);
    destination.searchParams.set('verified', 'true');
    response.redirect(302, destination.toString());
  };

  google = async (request: AuthenticatedRequest, response: Response) => {
    const logContext = { ...requestLogContext(request), provider: 'google' };
    request.log.info(logContext, 'OAuth login started');

    try {
      const returnTo = z.url().max(2048).optional().catch(undefined).parse(request.query['returnTo']);
      const { url } = await this.auth.beginGoogleLogin(this.safeReturnTo(returnTo));
      response.redirect(302, url);
    } catch (error) {
      request.log.error({ ...logContext, error: serializeLogError(error, this.includeErrorStack) }, 'OAuth login failed');
      throw error;
    }
  };

  callback = async (request: AuthenticatedRequest, response: Response) => {
    const logContext = { ...requestLogContext(request), provider: 'google' };

    try {
      const query = z.object({ code: z.string().min(1), attempt: z.string().min(1) }).parse(request.query);
      const result = await this.auth.completeGoogleLogin(query.code, query.attempt);
      this.setSessionCookies(response, result.sessionToken, result.csrfToken);
      request.log.info({ ...logContext, userId: result.identity.id }, 'OAuth login completed');
      response.redirect(302, this.safeReturnTo(result.returnTo) ?? this.frontendOrigin);
    } catch (error) {
      request.log.error({ ...logContext, error: serializeLogError(error, this.includeErrorStack) }, 'OAuth login failed');
      throw error;
    }
  };

  me = async (request: AuthenticatedRequest, response: Response) => {
    response.json({
      data: {
        user: request.principal!.user,
        csrfToken: request.principal!.csrfToken,
      },
    });
  };

  logout = async (request: AuthenticatedRequest, response: Response) => {
    await this.auth.logout(request.cookies[SESSION_COOKIE] as string);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
    response.status(204).end();
  };

  private setSessionCookies(response: Response, sessionToken: string, csrfToken: string) {
    const common = { secure: this.secureCookies, sameSite: 'lax' as const, path: '/' };
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    response.cookie(SESSION_COOKIE, sessionToken, { ...common, httpOnly: true, maxAge });
    response.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false, maxAge });
  }
}
