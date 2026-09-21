import { Router } from 'express';

import type { AudioController } from '../controllers/audio.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireCsrf } from '../middleware/authentication.js';

export function createWorkspaceAudioRoutes(controller: AudioController) {
  const router = Router({ mergeParams: true });
  router.get('/', asyncHandler(controller.list));
  router.post('/', requireCsrf, asyncHandler(controller.register));
  return router;
}

export function createAudioRoutes(controller: AudioController) {
  const router = Router();
  router.get('/:trackId', asyncHandler(controller.get));
  router.get('/:trackId/access', asyncHandler(controller.access));
  router.get('/:trackId/download', asyncHandler(controller.download));
  router.patch('/:trackId', requireCsrf, asyncHandler(controller.updateMetadata));
  router.delete('/:trackId', requireCsrf, asyncHandler(controller.remove));
  return router;
}

export function createProjectAudioRoutes(controller: AudioController) {
  const router = Router({ mergeParams: true });
  router.get('/', asyncHandler(controller.listProjectTracks));
  router.delete('/:trackId', requireCsrf, asyncHandler(controller.detach));
  return router;
}
