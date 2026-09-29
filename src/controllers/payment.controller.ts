import type { Response } from 'express';
import { z } from 'zod';

import { PLAN_IDS, type PlanId } from '../services/billing-plans.js';
import type { AuthenticatedRequest } from '../types/http.js';

const checkoutSchema = z.object({ plan: z.enum(PLAN_IDS) });
const idSchema = z.uuid();

export interface PaymentControllerService {
  listPlans(): unknown;
  getSubscription(userId: string, workspaceId: string): Promise<unknown>;
  createCheckout(userId: string, workspaceId: string, plan: PlanId): Promise<unknown>;
  getPayment(userId: string, paymentId: string): Promise<unknown>;
}

export class PaymentController {
  constructor(private readonly payments: PaymentControllerService) {}

  listPlans = async (_request: AuthenticatedRequest, response: Response) => {
    response.json({ data: this.payments.listPlans() });
  };
  getSubscription = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.payments.getSubscription(request.principal!.user.id, idSchema.parse(request.params.workspaceId)) });
  };
  createCheckout = async (request: AuthenticatedRequest, response: Response) => {
    const { plan } = checkoutSchema.parse(request.body);
    response.status(201).json({ data: await this.payments.createCheckout(request.principal!.user.id, idSchema.parse(request.params.workspaceId), plan) });
  };
  getPayment = async (request: AuthenticatedRequest, response: Response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ data: await this.payments.getPayment(request.principal!.user.id, idSchema.parse(request.params.paymentId)) });
  };
}
