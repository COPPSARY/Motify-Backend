import { Router } from 'express';

import type { AssetController } from '../controllers/asset.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireCsrf } from '../middleware/authentication.js';

export function createWorkspaceAssetRoutes(controller: AssetController) {
  const router = Router({ mergeParams: true });
  router.get('/', asyncHandler(controller.list));
  router.post('/uploads', requireCsrf, asyncHandler(controller.createUpload));
  router.post('/uploads/:uploadId/complete', requireCsrf, asyncHandler(controller.complete));
  return router;
}

export function createAssetRoutes(controller: AssetController) {
  const router = Router();
  router.put('/uploads/:uploadId/content', requireCsrf, asyncHandler(controller.upload));
  router.get('/:assetId', asyncHandler(controller.get));
  router.get('/:assetId/access', asyncHandler(controller.access));
  router.get('/:assetId/download', asyncHandler(controller.download));
  router.patch('/:assetId', requireCsrf, asyncHandler(controller.updateMetadata));
  router.delete('/:assetId', requireCsrf, asyncHandler(controller.remove));
  return router;
}

export function createProjectAssetRoutes(controller: AssetController) {
  const router = Router({ mergeParams: true });
  router.get('/', asyncHandler(controller.listProjectAssets));
  router.post('/', requireCsrf, asyncHandler(controller.attach));
  router.delete('/:assetId', requireCsrf, asyncHandler(controller.detach));
  return router;
}
