import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { assets, brandAssets, brandProfiles, workspaceMembers } from '../../packages/database/schema.js';

export type BrandProfileRecord = typeof brandProfiles.$inferSelect;
export type BrandAssetRoleValue = (typeof brandAssets.$inferSelect)['role'];
export type BrandSourceValue = (typeof brandAssets.$inferSelect)['source'];
export type AssetRow = typeof assets.$inferSelect;

export interface BrandAssetRecord {
  link: typeof brandAssets.$inferSelect;
  asset: AssetRow;
}

export interface SaveBrandProfileInput {
  dna: Record<string, unknown>;
  provenance: Record<string, unknown>;
  schemaVersion: number;
  updatedBy: string | null;
}

export interface PutBrandAssetInput {
  brandId: string;
  assetId: string;
  role: BrandAssetRoleValue;
  label: string | null;
  source: BrandSourceValue;
  sourceUrl: string | null;
  addedBy: string | null;
}

const SINGULAR_ROLES: readonly BrandAssetRoleValue[] = ['LOGO', 'FAVICON'];

export class DatabaseBrandRepository {
  constructor(private readonly db: Database) {}

  async getWorkspaceAccess(workspaceId: string, userId: string) {
    const [membership] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId),
    )).limit(1);
    return membership ?? null;
  }

  async getProfile(workspaceId: string) {
    const [profile] = await this.db.select().from(brandProfiles).where(eq(brandProfiles.workspaceId, workspaceId)).limit(1);
    return profile ?? null;
  }

  /** Returns the workspace's brand, creating an empty one the first time something is attached to it. */
  async ensureProfile(workspaceId: string, userId: string | null) {
    await this.db.insert(brandProfiles).values({ workspaceId, updatedBy: userId }).onConflictDoNothing({ target: brandProfiles.workspaceId });
    const profile = await this.getProfile(workspaceId);
    if (!profile) throw new Error('Unable to create the brand profile.');
    return profile;
  }

  /**
   * Writes the document against the revision it was read at. Revision 0 means
   * "no brand yet". Returns null when someone else saved in between.
   */
  async saveProfile(workspaceId: string, expectedRevision: number, input: SaveBrandProfileInput) {
    if (expectedRevision === 0) {
      const [created] = await this.db.insert(brandProfiles).values({ workspaceId, ...input })
        .onConflictDoNothing({ target: brandProfiles.workspaceId }).returning();
      return created ?? null;
    }
    const [updated] = await this.db.update(brandProfiles).set({
      ...input,
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    }).where(and(eq(brandProfiles.workspaceId, workspaceId), eq(brandProfiles.revision, expectedRevision))).returning();
    return updated ?? null;
  }

  async listAssets(brandId: string): Promise<BrandAssetRecord[]> {
    return this.db.select({ link: brandAssets, asset: assets }).from(brandAssets)
      .innerJoin(assets, eq(assets.id, brandAssets.assetId))
      .where(and(eq(brandAssets.brandId, brandId), eq(assets.state, 'READY')))
      .orderBy(asc(brandAssets.createdAt));
  }

  async getAsset(brandId: string, assetId: string) {
    const [row] = await this.db.select().from(brandAssets)
      .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.assetId, assetId))).limit(1);
    return row ?? null;
  }

  /**
   * Links an asset to the brand. A logo or favicon replaces the previous one;
   * the ids of whatever it displaced are returned so their files can be cleaned up.
   */
  async putAsset(input: PutBrandAssetInput): Promise<{ replaced: string[] }> {
    return this.db.transaction(async (tx) => {
      const replaced = SINGULAR_ROLES.includes(input.role)
        ? (await tx.delete(brandAssets).where(and(
            eq(brandAssets.brandId, input.brandId),
            eq(brandAssets.role, input.role),
            ne(brandAssets.assetId, input.assetId),
          )).returning({ assetId: brandAssets.assetId })).map((row) => row.assetId)
        : [];
      await tx.insert(brandAssets).values(input).onConflictDoUpdate({
        target: [brandAssets.brandId, brandAssets.assetId],
        set: { role: input.role, label: input.label, updatedAt: new Date() },
      });
      return { replaced };
    });
  }

  async updateAsset(brandId: string, assetId: string, input: { role?: BrandAssetRoleValue; label?: string | null }): Promise<{ replaced: string[] }> {
    return this.db.transaction(async (tx) => {
      const replaced = input.role && SINGULAR_ROLES.includes(input.role)
        ? (await tx.delete(brandAssets).where(and(
            eq(brandAssets.brandId, brandId),
            eq(brandAssets.role, input.role),
            ne(brandAssets.assetId, assetId),
          )).returning({ assetId: brandAssets.assetId })).map((row) => row.assetId)
        : [];
      await tx.update(brandAssets).set({ ...input, updatedAt: new Date() })
        .where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.assetId, assetId)));
      return { replaced };
    });
  }

  async removeAsset(brandId: string, assetId: string) {
    await this.db.delete(brandAssets).where(and(eq(brandAssets.brandId, brandId), eq(brandAssets.assetId, assetId)));
  }

  /** Which of these assets some brand still uses. */
  async assetsInUse(assetIds: readonly string[]) {
    if (assetIds.length === 0) return new Set<string>();
    const rows = await this.db.select({ assetId: brandAssets.assetId }).from(brandAssets).where(inArray(brandAssets.assetId, [...assetIds]));
    return new Set(rows.map((row) => row.assetId));
  }
}
