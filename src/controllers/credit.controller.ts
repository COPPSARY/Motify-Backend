import type { Response } from 'express';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../types/http.js';

const historyQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(300).optional(),
});

export interface CreditControllerService {
  getBalance(userId: string): Promise<unknown>;
  listHistory(userId: string, input: { limit: number; cursor?: string | undefined }): Promise<unknown>;
}

/**
 * Credits are read-only over HTTP. The user is always the session's own, never
 * a path, query, or body value, so there is no id here to tamper with.
 */
export class CreditController {
  constructor(private readonly credits: CreditControllerService) {}

  balance = async (request: AuthenticatedRequest, response: Response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ data: await this.credits.getBalance(request.principal!.user.id) });
  };

  history = async (request: AuthenticatedRequest, response: Response) => {
    const query = historyQuerySchema.parse(request.query);
    response.set('Cache-Control', 'no-store');
    response.json({ data: await this.credits.listHistory(request.principal!.user.id, query) });
  };
}
