import type { Response } from 'express';
import { z } from 'zod';

import { PLAN_IDS } from '../services/billing-plans.js';
import type { Purchase } from '../services/payment.service.js';
import type { AuthenticatedRequest } from '../types/http.js';

// Exactly one of `plan` or `creditPack`.
const checkoutSchema = z.union([
  z.strictObject({ plan: z.enum(PLAN_IDS) }),
  z.strictObject({ creditPack: z.string().regex(/^credits-\d{1,7}$/) }),
]);
const idSchema = z.uuid();

export interface PaymentControllerService {
  listPlans(): unknown;
  listCreditPacks(): unknown;
  getSubscription(userId: string, workspaceId: string): Promise<unknown>;
  createCheckout(userId: string, workspaceId: string, purchase: Purchase): Promise<unknown>;
  getPayment(userId: string, paymentId: string): Promise<unknown>;
}

export class PaymentController {
  constructor(private readonly payments: PaymentControllerService) {}

  listPlans = async (_request: AuthenticatedRequest, response: Response) => {
    response.json({ data: this.payments.listPlans() });
  };
  listCreditPacks = async (_request: AuthenticatedRequest, response: Response) => {
    response.json({ data: this.payments.listCreditPacks() });
  };
  getSubscription = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.payments.getSubscription(request.principal!.user.id, idSchema.parse(request.params.workspaceId)) });
  };
  createCheckout = async (request: AuthenticatedRequest, response: Response) => {
    const purchase = checkoutSchema.parse(request.body);
    response.status(201).json({ data: await this.payments.createCheckout(request.principal!.user.id, idSchema.parse(request.params.workspaceId), purchase) });
  };
  getPayment = async (request: AuthenticatedRequest, response: Response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ data: await this.payments.getPayment(request.principal!.user.id, idSchema.parse(request.params.paymentId)) });
  };
}
