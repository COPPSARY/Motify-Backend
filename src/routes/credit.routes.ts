import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import type { CreditController } from '../controllers/credit.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../types/http.js';

/** Read-only. No route here accepts a write, so a client cannot set its own balance. */
export function createCreditRoutes(controller: CreditController) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Mounted behind requireAuthentication, so a principal is always present.
    keyGenerator: (request) => (request as AuthenticatedRequest).principal!.user.id,
  });
  router.get('/', limiter, asyncHandler(controller.balance));
  router.get('/history', limiter, asyncHandler(controller.history));
  return router;
}
