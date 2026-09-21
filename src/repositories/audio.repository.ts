import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../packages/database/client.js';
import { audioTracks, projectAudioTracks, projects, workspaceMembers } from '../../packages/database/schema.js';

export type AudioTrackRecord = typeof audioTracks.$inferSelect;

export interface AudioTrackMetadataInput {
  title?: string;
  artist?: string | null;
  genre?: string | null;
  moodTags?: string[];
  bpm?: number | null;
}

export class DatabaseAudioRepository {
  constructor(private readonly db: Database) {}

  async create(input: typeof audioTracks.$inferInsert) {
    const [track] = await this.db.insert(audioTracks).values(input).returning();
    if (!track) throw new Error('Unable to create audio track.');
    return track;
  }

  async getByAssetId(assetId: string) {
    const [track] = await this.db.select().from(audioTracks).where(eq(audioTracks.assetId, assetId)).limit(1);
    return track ?? null;
  }

  async getSystemByChecksum(checksum: string) {
    const [track] = await this.db.select().from(audioTracks)
      .where(and(eq(audioTracks.scope, 'SYSTEM'), eq(audioTracks.checksum, checksum))).limit(1);
    return track ?? null;
  }

  /** System tracks are readable by everyone; workspace tracks only by members. `role` is null for system tracks. */
  async getReadableForUser(trackId: string, userId: string) {
    const [row] = await this.db.select({ track: audioTracks, role: workspaceMembers.role }).from(audioTracks)
      .leftJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, audioTracks.workspaceId), eq(workspaceMembers.userId, userId)))
      .where(and(eq(audioTracks.id, trackId), or(eq(audioTracks.scope, 'SYSTEM'), sql`${workspaceMembers.userId} is not null`)))
      .limit(1);
    return row ?? null;
  }

  async list(workspaceId: string, scope: 'all' | 'workspace' | 'system', page: number, pageSize: number, query?: string) {
    const pattern = query ? `%${escapeLike(query)}%` : null;
    const search = pattern ? or(
      ilike(audioTracks.title, pattern),
      ilike(audioTracks.artist, pattern),
      ilike(audioTracks.genre, pattern),
      sql`exists (select 1 from unnest(${audioTracks.moodTags}) as tag where tag ilike ${pattern} escape '\\')`,
    ) : undefined;
    const visible = {
      all: or(eq(audioTracks.scope, 'SYSTEM'), eq(audioTracks.workspaceId, workspaceId)),
      workspace: eq(audioTracks.workspaceId, workspaceId),
      system: eq(audioTracks.scope, 'SYSTEM'),
    }[scope];
    const where = and(visible, search);
    const [data, total] = await Promise.all([
      this.db.select().from(audioTracks).where(where)
        .orderBy(asc(audioTracks.scope), desc(audioTracks.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ value: count() }).from(audioTracks).where(where),
    ]);
    return { data, totalItems: total[0]?.value ?? 0 };
  }

  async updateMetadata(trackId: string, input: AudioTrackMetadataInput) {
    const [track] = await this.db.update(audioTracks).set({ ...input, updatedAt: new Date() })
      .where(eq(audioTracks.id, trackId)).returning();
    return track ?? null;
  }

  async delete(trackId: string) {
    await this.db.delete(audioTracks).where(eq(audioTracks.id, trackId));
  }

  async attach(projectId: string, trackId: string, attachedBy: string) {
    await this.db.insert(projectAudioTracks).values({ projectId, trackId, attachedBy }).onConflictDoNothing();
  }

  async detach(projectId: string, trackId: string) {
    await this.db.delete(projectAudioTracks).where(and(eq(projectAudioTracks.projectId, projectId), eq(projectAudioTracks.trackId, trackId)));
  }

  async countAttachments(trackId: string) {
    const [result] = await this.db.select({ value: count() }).from(projectAudioTracks)
      .innerJoin(projects, eq(projects.id, projectAudioTracks.projectId))
      .where(and(eq(projectAudioTracks.trackId, trackId), isNull(projects.archivedAt)));
    return result?.value ?? 0;
  }

  async listAttached(projectId: string) {
    return this.db.select({ track: audioTracks }).from(projectAudioTracks)
      .innerJoin(audioTracks, eq(audioTracks.id, projectAudioTracks.trackId))
      .where(eq(projectAudioTracks.projectId, projectId))
      .orderBy(projectAudioTracks.createdAt)
      .then((rows) => rows.map((row) => row.track));
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
