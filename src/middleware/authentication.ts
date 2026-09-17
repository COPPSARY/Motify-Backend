import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, RequestHandler, Response } from 'express';

import { AppError } from '../errors.js';
import type { AuthenticatedRequest, SessionResolver } from '../types/http.js';

export const SESSION_COOKIE = 'motify_session';
export const CSRF_COOKIE = 'motify_csrf';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function resolveSession(sessions: SessionResolver): RequestHandler {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    const token = request.cookies[SESSION_COOKIE] as string | undefined;
    Promise.resolve(token ? sessions.resolve(token) : null)
      .then((principal) => {
        if (principal) request.principal = principal;
        next();
      })
      .catch(next);
  };
}

export const requireAuthentication: RequestHandler = (request: AuthenticatedRequest, _response, next) => {
  if (!request.principal) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
  next();
};

export const requireCsrf: RequestHandler = (request: AuthenticatedRequest, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const supplied = request.header('x-csrf-token') ?? '';
  if (!request.principal || !safeEqual(supplied, request.principal.csrfToken)) {
    return next(new AppError(403, 'CSRF_INVALID', 'The CSRF token is missing or invalid.'));
  }
  next();
};

