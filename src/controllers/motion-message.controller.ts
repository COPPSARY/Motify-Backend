import type { Response } from 'express';
import { z } from 'zod';
import type { MessageResult } from '../services/generation.service.js';
import type { AuthenticatedRequest } from '../types/http.js';

const idSchema = z.string().uuid();

/**
 * A frame the editor rendered from the candidate this message is repairing.
 *
 * Frames arrive inline rather than as uploaded assets on purpose. An upload
 * would file screenshots of a broken film in the user's own workspace library,
 * and would have to claim a role - `reference` - that tells the model to
 * reproduce what it shows. These are evidence about one request and nothing
 * about them should outlive it.
 */
const frameSchema = z.strictObject({
  capturedAtSeconds: z.number().min(0).max(3_600),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  // Roughly 300KB decoded. A frame is a 512px still; anything larger is not a
  // frame, and four of them must stay well inside the 20mb body limit.
  dataBase64: z.string().min(1).max(400_000),
});

const messageSchema = z.strictObject({
  message: z.string().trim().min(1).max(20_000),
  runtimeError: z.strictObject({ message: z.string().trim().min(1).max(4_000) }).optional(),
  revision: z.number().int().min(1).optional(),
  assets: z.array(z.strictObject({
    assetId: z.string().uuid(),
    role: z.enum(['reference', 'asset']),
  })).max(10).optional(),
  audio: z.array(z.strictObject({ trackId: z.string().uuid() })).max(3).optional(),
  frames: z.array(frameSchema).max(4).optional(),
}).superRefine((value, context) => {
  if (value.runtimeError && value.revision === undefined) context.addIssue({ code: 'custom', path: ['revision'], message: 'revision is required for runtime repair.' });
});

export interface MotionMessageService {
  sendMessage(userId: string, projectId: string, input: z.infer<typeof messageSchema>): Promise<MessageResult>;
}
export class MotionMessageController {
  constructor(private readonly service: MotionMessageService) {}
  send = async (request: AuthenticatedRequest, response: Response) => {
    const projectId = idSchema.parse(request.params.projectId);
    response.json({ data: await this.service.sendMessage(request.principal!.user.id, projectId, messageSchema.parse(request.body)) });
  };
}
