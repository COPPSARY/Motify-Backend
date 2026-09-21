import type { GenerationAudioTrack } from '../../packages/ai/graph/dependencies.js';
import { assetKind } from '../../packages/object-storage/asset-validation.js';
import type { PrivateObjectStorage } from '../../packages/object-storage/types.js';
import { AppError } from '../errors.js';
import type { DatabaseAssetRepository } from '../repositories/asset.repository.js';
import type { AudioTrackMetadataInput, AudioTrackRecord, DatabaseAudioRepository } from '../repositories/audio.repository.js';
import type { AudioAttachmentInput } from './generation.service.js';
import type { WorkspaceRole } from './workspace.service.js';

export interface RegisterAudioTrackInput extends AudioTrackMetadataInput {
  assetId: string;
}

export type AudioTrackScopeFilter = 'all' | 'workspace' | 'system';

/** Generation may reference at most this many tracks, e.g. a music bed plus a voiceover. */
const MAX_GENERATION_TRACKS = 3;

/**
 * The music library. Users register uploaded audio assets as workspace tracks;
 * developers seed system tracks with `npm run audio:seed`. System tracks are
 * readable by every signed-in user and never mutable over the API.
 */
export class AudioService {
  constructor(
    private readonly repository: DatabaseAudioRepository,
    private readonly assets: DatabaseAssetRepository,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async register(userId: string, workspaceId: string, input: RegisterAudioTrackInput) {
    const access = await this.assets.getWorkspaceAccess(workspaceId, userId);
    if (!access) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    requireWrite(access.role);
    const asset = await this.assets.getReadableForUser(input.assetId, userId);
    if (!asset || asset.asset.workspaceId !== workspaceId) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    if (assetKind(asset.asset.contentType) !== 'audio' || asset.asset.durationMs === null) {
      throw new AppError(422, 'ASSET_KIND_UNSUPPORTED', 'Only uploaded audio can be added to the music library.');
    }
    if (await this.repository.getByAssetId(asset.asset.id)) {
      throw new AppError(409, 'AUDIO_TRACK_EXISTS', 'This audio file is already in the music library.');
    }
    const track = await this.repository.create({
      scope: 'WORKSPACE',
      workspaceId,
      assetId: asset.asset.id,
      createdBy: userId,
      title: input.title ?? stripExtension(asset.asset.fileName),
      artist: input.artist ?? null,
      genre: input.genre ?? null,
      moodTags: input.moodTags ?? [],
      bpm: input.bpm ?? null,
      durationMs: asset.asset.durationMs,
      contentType: asset.asset.contentType,
      byteSize: asset.asset.byteSize,
      checksum: asset.asset.checksum,
      objectKey: asset.asset.objectKey,
    });
    return toTrackResource(track);
  }

  async list(userId: string, workspaceId: string, scope: AudioTrackScopeFilter, page: number, pageSize: number, query?: string) {
    if (!(await this.assets.getWorkspaceAccess(workspaceId, userId))) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    const result = await this.repository.list(workspaceId, scope, page, pageSize, query);
    return {
      data: result.data.map(toTrackResource),
      pagination: { page, pageSize, totalItems: result.totalItems, totalPages: Math.ceil(result.totalItems / pageSize) },
    };
  }

  async get(userId: string, trackId: string) {
    return toTrackResource((await this.readable(userId, trackId)).track);
  }

  async updateMetadata(userId: string, trackId: string, input: AudioTrackMetadataInput) {
    await this.writable(userId, trackId);
    const track = await this.repository.updateMetadata(trackId, input);
    if (!track) throw new AppError(404, 'AUDIO_TRACK_NOT_FOUND', 'Audio track not found.');
    return toTrackResource(track);
  }

  async remove(userId: string, trackId: string) {
    const track = await this.writable(userId, trackId);
    if (await this.repository.countAttachments(trackId)) {
      throw new AppError(409, 'AUDIO_TRACK_IN_USE', 'Remove this track from every project before deleting it.');
    }
    await this.repository.delete(trackId);
    if (track.assetId) await this.assets.updateState(track.assetId, 'DELETED');
    await this.storage.delete(track.objectKey);
  }

  async createAccess(userId: string, trackId: string) {
    const { track } = await this.readable(userId, trackId);
    const expiresIn = 300;
    const url = this.storage.bucket === 'local'
      ? `/v1/audio/${trackId}/download`
      : await this.storage.createSignedReadUrl(track.objectKey, expiresIn);
    return { url, expiresIn };
  }

  async download(userId: string, trackId: string) {
    const { track } = await this.readable(userId, trackId);
    const base = { contentType: track.contentType, fileName: `${track.title}${extensionFor(track.contentType)}` };
    if (this.storage.bucket === 'local') {
      return { ...base, kind: 'file' as const, path: await this.storage.resolvePath(track.objectKey) };
    }
    return { ...base, kind: 'redirect' as const, url: await this.storage.createSignedReadUrl(track.objectKey, 300) };
  }

  async listProjectTracks(userId: string, projectId: string) {
    const project = await this.assets.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    return (await this.repository.listAttached(projectId)).map(toTrackResource);
  }

  async detach(userId: string, projectId: string, trackId: string) {
    const project = await this.assets.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    requireWrite(project.role);
    await this.repository.detach(projectId, trackId);
  }

  /**
   * Returns metadata only: the model cannot hear audio, so it paces the film from
   * duration, tempo and mood and places the track's token. Requested tracks are
   * attached to the project; without a request the attached tracks carry over, so
   * an edit keeps the soundtrack it already had.
   */
  async resolveGenerationAudio(
    userId: string,
    projectId: string,
    requested: readonly AudioAttachmentInput[] | undefined,
  ): Promise<GenerationAudioTrack[]> {
    const project = await this.assets.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    requireWrite(project.role);
    if (!requested) return (await this.repository.listAttached(projectId)).map(toGenerationTrack);
    if (requested.length > MAX_GENERATION_TRACKS) {
      throw new AppError(422, 'AUDIO_LIMIT_EXCEEDED', `A generation can use at most ${MAX_GENERATION_TRACKS} audio tracks.`);
    }
    if (new Set(requested.map((entry) => entry.trackId)).size !== requested.length) {
      throw new AppError(422, 'AUDIO_TRACK_DUPLICATE', 'Each audio track may appear only once.');
    }
    return Promise.all(requested.map(async ({ trackId }) => {
      const access = await this.repository.getReadableForUser(trackId, userId);
      if (!access || (access.track.scope === 'WORKSPACE' && access.track.workspaceId !== project.project.workspaceId)) {
        throw new AppError(404, 'AUDIO_TRACK_NOT_FOUND', 'Audio track not found.');
      }
      await this.repository.attach(projectId, trackId, userId);
      return toGenerationTrack(access.track);
    }));
  }

  private async readable(userId: string, trackId: string) {
    const access = await this.repository.getReadableForUser(trackId, userId);
    if (!access) throw new AppError(404, 'AUDIO_TRACK_NOT_FOUND', 'Audio track not found.');
    return access;
  }

  private async writable(userId: string, trackId: string) {
    const { track, role } = await this.readable(userId, trackId);
    if (track.scope === 'SYSTEM' || !role) throw new AppError(403, 'AUDIO_TRACK_READ_ONLY', 'Built-in tracks cannot be changed.');
    requireWrite(role);
    return track;
  }
}

function requireWrite(role: WorkspaceRole) {
  if (role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.');
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').slice(0, 100) || fileName;
}

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/webm': '.weba',
};

function extensionFor(contentType: string) {
  return EXTENSIONS[contentType] ?? '';
}

export function audioToken(trackId: string) {
  return `motify-audio://${trackId}`;
}

function toGenerationTrack(track: AudioTrackRecord): GenerationAudioTrack {
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    moodTags: track.moodTags,
    bpm: track.bpm,
    durationMs: track.durationMs,
  };
}

function toTrackResource(track: AudioTrackRecord) {
  return {
    id: track.id,
    scope: track.scope === 'SYSTEM' ? 'system' as const : 'workspace' as const,
    workspaceId: track.workspaceId,
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    moodTags: track.moodTags,
    bpm: track.bpm,
    license: track.license,
    durationMs: track.durationMs,
    contentType: track.contentType,
    byteSize: track.byteSize,
    token: audioToken(track.id),
    createdAt: track.createdAt.toISOString(),
  };
}
