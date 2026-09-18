import type { Response } from 'express';
import { z } from 'zod';
import type { MessageResult } from '../services/generation.service.js';
import type { AuthenticatedRequest } from '../types/http.js';

const idSchema = z.string().uuid();
const messageSchema = z.strictObject({
  message: z.string().trim().min(1).max(20_000),
  runtimeError: z.strictObject({ message: z.string().trim().min(1).max(4_000) }).optional(),
  revision: z.number().int().min(1).optional(),
  assets: z.array(z.strictObject({
    assetId: z.string().uuid(),
    role: z.enum(['reference', 'asset']),
  })).max(10).optional(),
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
