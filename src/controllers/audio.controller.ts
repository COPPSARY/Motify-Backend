import type { Response } from 'express';
import { z } from 'zod';

import type { AudioTrackMetadataInput } from '../repositories/audio.repository.js';
import type { AudioTrackScopeFilter, RegisterAudioTrackInput } from '../services/audio.service.js';
import type { AuthenticatedRequest } from '../types/http.js';

const idSchema = z.string().uuid();
const metadataFields = {
  title: z.string().trim().min(1).max(100).optional(),
  artist: z.string().trim().min(1).max(100).nullable().optional(),
  genre: z.string().trim().min(1).max(40).nullable().optional(),
  moodTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  bpm: z.number().int().min(20).max(300).nullable().optional(),
};
const registerSchema = z.strictObject({ assetId: z.string().uuid(), ...metadataFields });
const updateSchema = z.strictObject(metadataFields).refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  { message: 'At least one metadata field is required.' },
);
const listSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(['all', 'workspace', 'system']).default('all'),
});

export interface AudioControllerService {
  register(userId: string, workspaceId: string, input: RegisterAudioTrackInput): Promise<unknown>;
  list(userId: string, workspaceId: string, scope: AudioTrackScopeFilter, page: number, pageSize: number, query?: string): Promise<unknown>;
  get(userId: string, trackId: string): Promise<unknown>;
  updateMetadata(userId: string, trackId: string, input: AudioTrackMetadataInput): Promise<unknown>;
  remove(userId: string, trackId: string): Promise<void>;
  createAccess(userId: string, trackId: string): Promise<unknown>;
  download(userId: string, trackId: string): Promise<
    { kind: 'file'; path: string; contentType: string; fileName: string }
    | { kind: 'redirect'; url: string; contentType: string; fileName: string }
  >;
  listProjectTracks(userId: string, projectId: string): Promise<unknown>;
  detach(userId: string, projectId: string, trackId: string): Promise<void>;
}

export class AudioController {
  constructor(private readonly audio: AudioControllerService) {}

  register = async (request: AuthenticatedRequest, response: Response) => {
    const workspaceId = idSchema.parse(request.params.workspaceId);
    response.status(201).json({ data: await this.audio.register(request.principal!.user.id, workspaceId, withoutUndefined(registerSchema.parse(request.body))) });
  };
  list = async (request: AuthenticatedRequest, response: Response) => {
    const workspaceId = idSchema.parse(request.params.workspaceId);
    const { page, pageSize, q, scope } = listSchema.parse(request.query);
    response.json(await this.audio.list(request.principal!.user.id, workspaceId, scope, page, pageSize, q));
  };
  get = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.audio.get(request.principal!.user.id, idSchema.parse(request.params.trackId)) });
  };
  updateMetadata = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.audio.updateMetadata(
      request.principal!.user.id,
      idSchema.parse(request.params.trackId),
      withoutUndefined(updateSchema.parse(request.body)),
    ) });
  };
  remove = async (request: AuthenticatedRequest, response: Response) => {
    await this.audio.remove(request.principal!.user.id, idSchema.parse(request.params.trackId));
    response.status(204).end();
  };
  access = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.audio.createAccess(request.principal!.user.id, idSchema.parse(request.params.trackId)) });
  };
  download = async (request: AuthenticatedRequest, response: Response) => {
    const track = await this.audio.download(request.principal!.user.id, idSchema.parse(request.params.trackId));
    if (track.kind === 'redirect') {
      response.redirect(302, track.url);
      return;
    }
    response.type(track.contentType).download(track.path, track.fileName);
  };
  listProjectTracks = async (request: AuthenticatedRequest, response: Response) => {
    response.json({ data: await this.audio.listProjectTracks(request.principal!.user.id, idSchema.parse(request.params.projectId)) });
  };
  detach = async (request: AuthenticatedRequest, response: Response) => {
    await this.audio.detach(request.principal!.user.id, idSchema.parse(request.params.projectId), idSchema.parse(request.params.trackId));
    response.status(204).end();
  };
}

/** `exactOptionalPropertyTypes` rejects explicit `undefined`, so absent fields are dropped. */
function withoutUndefined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}
