import { Router } from 'express';

import type { BrandController } from '../controllers/brand.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireCsrf } from '../middleware/authentication.js';

export function createWorkspaceBrandRoutes(controller: BrandController) {
  const router = Router({ mergeParams: true });
  router.get('/', asyncHandler(controller.get));
  router.put('/', requireCsrf, asyncHandler(controller.update));
  router.post('/assets', requireCsrf, asyncHandler(controller.addAsset));
  router.patch('/assets/:assetId', requireCsrf, asyncHandler(controller.updateAsset));
  router.delete('/assets/:assetId', requireCsrf, asyncHandler(controller.removeAsset));
  return router;
}
