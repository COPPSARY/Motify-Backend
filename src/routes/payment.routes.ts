import { Router } from 'express';

import type { PaymentController } from '../controllers/payment.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireCsrf } from '../middleware/authentication.js';

export function createBillingRoutes(controller: PaymentController) {
  const router = Router();
  router.get('/plans', asyncHandler(controller.listPlans));
  router.get('/credit-packs', asyncHandler(controller.listCreditPacks));
  return router;
}

export function createWorkspaceBillingRoutes(controller: PaymentController) {
  const router = Router({ mergeParams: true });
  router.get('/subscription', asyncHandler(controller.getSubscription));
  router.post('/payments', requireCsrf, asyncHandler(controller.createCheckout));
  return router;
}

export function createPaymentRoutes(controller: PaymentController) {
  const router = Router();
  router.get('/:paymentId', asyncHandler(controller.getPayment));
  return router;
}
