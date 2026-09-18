import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { assets, projectAssets, projects, workspaceMembers } from '../../packages/database/schema.js';

export type AssetRecord = typeof assets.$inferSelect;

export class DatabaseAssetRepository {
  constructor(private readonly db: Database) {}

  async getWorkspaceAccess(workspaceId: string, userId: string) {
    const [membership] = await this.db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId),
    )).limit(1);
    return membership ?? null;
  }

  async getProjectAccess(projectId: string, userId: string) {
    const [row] = await this.db.select({ project: { id: projects.id, workspaceId: projects.workspaceId }, role: workspaceMembers.role })
      .from(projects).innerJoin(workspaceMembers, and(
        eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId),
      )).where(and(eq(projects.id, projectId), isNull(projects.archivedAt))).limit(1);
    return row ?? null;
  }

  async create(input: typeof assets.$inferInsert) {
    const [asset] = await this.db.insert(assets).values(input).returning();
    if (!asset) throw new Error('Unable to create asset upload.');
    return asset;
  }

  async getForUser(assetId: string, userId: string) {
    const [row] = await this.db.select({ asset: assets, role: workspaceMembers.role }).from(assets)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, assets.workspaceId), eq(workspaceMembers.userId, userId)))
      .where(and(eq(assets.id, assetId), eq(assets.state, 'PENDING'))).limit(1);
    return row ?? null;
  }

  async getReadableForUser(assetId: string, userId: string) {
    const [row] = await this.db.select({ asset: assets, role: workspaceMembers.role }).from(assets)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, assets.workspaceId), eq(workspaceMembers.userId, userId)))
      .where(and(eq(assets.id, assetId), eq(assets.state, 'READY'))).limit(1);
    return row ?? null;
  }

  async getForCompletion(assetId: string, userId: string) {
    const [row] = await this.db.select({ asset: assets, role: workspaceMembers.role }).from(assets)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, assets.workspaceId), eq(workspaceMembers.userId, userId)))
      .where(and(eq(assets.id, assetId), inArray(assets.state, ['PENDING', 'READY']))).limit(1);
    return row ?? null;
  }

  async updateState(assetId: string, state: 'PENDING' | 'READY' | 'FAILED' | 'DELETED') {
    const [asset] = await this.db.update(assets).set({ state, updatedAt: new Date() }).where(eq(assets.id, assetId)).returning();
    return asset ?? null;
  }

  async markReady(assetId: string, dimensions: { width: number; height: number }) {
    const [asset] = await this.db.update(assets).set({
      state: 'READY',
      width: dimensions.width,
      height: dimensions.height,
      updatedAt: new Date(),
    }).where(eq(assets.id, assetId)).returning();
    return asset ?? null;
  }

  async list(workspaceId: string, page: number, pageSize: number, query?: string) {
    const pattern = query ? `%${escapeLike(query)}%` : null;
    const search = pattern ? or(
      ilike(assets.fileName, pattern),
      ilike(assets.label, pattern),
      sql`exists (select 1 from unnest(${assets.tags}) as tag where tag ilike ${pattern} escape '\\')`,
    ) : undefined;
    const where = and(eq(assets.workspaceId, workspaceId), eq(assets.state, 'READY'), search);
    const [data, total] = await Promise.all([
      this.db.select().from(assets).where(where).orderBy(desc(assets.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ value: count() }).from(assets).where(where),
    ]);
    return { data, totalItems: total[0]?.value ?? 0 };
  }

  async attach(projectId: string, assetId: string, attachedBy: string, role: 'REFERENCE' | 'ASSET' = 'ASSET') {
    await this.db.insert(projectAssets).values({ projectId, assetId, attachedBy, role }).onConflictDoUpdate({
      target: [projectAssets.projectId, projectAssets.assetId],
      set: { role, attachedBy, updatedAt: new Date() },
    });
  }

  async detach(projectId: string, assetId: string) {
    await this.db.delete(projectAssets).where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, assetId)));
  }

  async updateMetadata(assetId: string, input: { label?: string | null; tags?: string[] }) {
    const [asset] = await this.db.update(assets).set({
      ...input,
      updatedAt: new Date(),
    }).where(eq(assets.id, assetId)).returning();
    return asset ?? null;
  }

  async countAttachments(assetId: string) {
    const [result] = await this.db.select({ value: count() }).from(projectAssets)
      .innerJoin(projects, eq(projects.id, projectAssets.projectId))
      .where(and(eq(projectAssets.assetId, assetId), isNull(projects.archivedAt)));
    return result?.value ?? 0;
  }

  async listAttached(projectId: string) {
    return this.db.select({ asset: assets, role: projectAssets.role }).from(projectAssets)
      .innerJoin(assets, eq(assets.id, projectAssets.assetId))
      .where(and(eq(projectAssets.projectId, projectId), eq(assets.state, 'READY')))
      .orderBy(projectAssets.createdAt);
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
