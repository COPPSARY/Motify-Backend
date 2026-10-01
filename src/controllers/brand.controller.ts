import type { Response } from 'express';
import { z } from 'zod';

import { BRAND_ASSET_ROLES, brandDnaSchema, type BrandAssetRole, type BrandDna } from '../../packages/brand/brand-dna.js';
import type { AuthenticatedRequest } from '../types/http.js';

const idSchema = z.string().uuid();
const labelSchema = z.string().trim().max(80).transform((value) => value || null).nullable();
const updateSchema = z.strictObject({ revision: z.number().int().min(0), dna: brandDnaSchema });
const addAssetSchema = z.strictObject({ assetId: z.string().uuid(), role: z.enum(BRAND_ASSET_ROLES), label: labelSchema.optional() });
const updateAssetSchema = z.strictObject({ role: z.enum(BRAND_ASSET_ROLES).optional(), label: labelSchema.optional() }).refine(
  (input) => input.role !== undefined || input.label !== undefined,
  { message: 'Send a role or a label.' },
);

export interface BrandControllerService {
  get(userId: string, workspaceId: string): Promise<unknown>;
  update(userId: string, workspaceId: string, input: { revision: number; dna: BrandDna }): Promise<unknown>;
  addAsset(userId: string, workspaceId: string, input: { assetId: string; role: BrandAssetRole; label?: string | null }): Promise<unknown>;
  updateAsset(userId: string, workspaceId: string, assetId: string, input: { role?: BrandAssetRole; label?: string | null }): Promise<unknown>;
  removeAsset(userId: string, workspaceId: string, assetId: string): Promise<void>;
}

export class BrandController {
  constructor(private readonly brand: BrandControllerService) {}

  get = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.brand.get(request.principal!.user.id, idSchema.parse(request.params.workspaceId)) });
  };
  update = async (request: AuthenticatedRequest, response: Response) => {
    const workspaceId = idSchema.parse(request.params.workspaceId);
    response.json({ data: await this.brand.update(request.principal!.user.id, workspaceId, updateSchema.parse(request.body)) });
  };
  addAsset = async (request: AuthenticatedRequest, response: Response) => {
    const workspaceId = idSchema.parse(request.params.workspaceId);
    response.status(201).json({ data: await this.brand.addAsset(request.principal!.user.id, workspaceId, withoutUndefined(addAssetSchema.parse(request.body))) });
  };
  updateAsset = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.brand.updateAsset(
      request.principal!.user.id,
      idSchema.parse(request.params.workspaceId),
      idSchema.parse(request.params.assetId),
      withoutUndefined(updateAssetSchema.parse(request.body)),
    ) });
  };
  removeAsset = async (request: AuthenticatedRequest, response: Response) => {
    await this.brand.removeAsset(request.principal!.user.id, idSchema.parse(request.params.workspaceId), idSchema.parse(request.params.assetId));
    response.status(204).end();
  };
}

/** `exactOptionalPropertyTypes` rejects explicit `undefined`, so absent fields are dropped. */
function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}
