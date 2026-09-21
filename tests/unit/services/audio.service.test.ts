import { describe, expect, it, vi } from 'vitest';

import { AudioService } from '../../../src/services/audio.service.js';

const workspaceId = '00000000-0000-4000-8000-000000000002';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000009';

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: 'track-id', scope: 'WORKSPACE', workspaceId, assetId: 'asset-id', createdBy: 'user-id',
    title: 'Bright Future', artist: null, genre: 'electronic', moodTags: ['upbeat'], bpm: 120, license: null,
    durationMs: 32_000, contentType: 'audio/mpeg', byteSize: 10, checksum: 'a'.repeat(64), objectKey: 'objects/song',
    createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(options: { role?: string; asset?: Record<string, unknown>; existing?: unknown; readable?: unknown; attachments?: number } = {}) {
  const audio = {
    create: vi.fn().mockImplementation(async (input: object) => track(input as Record<string, unknown>)),
    getByAssetId: vi.fn().mockResolvedValue(options.existing ?? null),
    getReadableForUser: vi.fn().mockResolvedValue(options.readable ?? { track: track(), role: options.role ?? 'editor' }),
    updateMetadata: vi.fn().mockImplementation(async (_id: string, input: object) => track(input as Record<string, unknown>)),
    delete: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    countAttachments: vi.fn().mockResolvedValue(options.attachments ?? 0),
    listAttached: vi.fn().mockResolvedValue([track()]),
  };
  const assets = {
    getWorkspaceAccess: vi.fn().mockResolvedValue({ role: options.role ?? 'editor' }),
    getProjectAccess: vi.fn().mockResolvedValue({ project: { id: 'project-id', workspaceId }, role: options.role ?? 'editor' }),
    getReadableForUser: vi.fn().mockResolvedValue({
      asset: {
        id: 'asset-id', workspaceId, fileName: 'bright-future.mp3', contentType: 'audio/mpeg', durationMs: 32_000,
        byteSize: 10, checksum: 'a'.repeat(64), objectKey: 'objects/song', ...options.asset,
      },
      role: options.role ?? 'editor',
    }),
    updateState: vi.fn(),
  };
  const storage = { bucket: 'motify-assets', delete: vi.fn(), createSignedReadUrl: vi.fn().mockResolvedValue('https://storage/signed') };
  return { audio, assets, storage, service: new AudioService(audio as never, assets as never, storage as never) };
}

describe('AudioService library', () => {
  it('registers an uploaded audio asset as a workspace track', async () => {
    const { service, audio } = setup();

    await expect(service.register('user-id', workspaceId, { assetId: 'asset-id', bpm: 120 })).resolves.toMatchObject({
      scope: 'workspace', title: 'bright-future', durationMs: 32_000, token: 'motify-audio://track-id',
    });
    expect(audio.create).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'WORKSPACE', workspaceId, assetId: 'asset-id', createdBy: 'user-id', objectKey: 'objects/song', bpm: 120,
    }));
  });

  it('rejects images, duplicates, other workspaces and viewers', async () => {
    await expect(setup({ asset: { contentType: 'image/png', durationMs: null } }).service.register('user-id', workspaceId, { assetId: 'asset-id' }))
      .rejects.toMatchObject({ code: 'ASSET_KIND_UNSUPPORTED' });
    await expect(setup({ existing: track() }).service.register('user-id', workspaceId, { assetId: 'asset-id' }))
      .rejects.toMatchObject({ code: 'AUDIO_TRACK_EXISTS' });
    await expect(setup({ asset: { workspaceId: otherWorkspaceId } }).service.register('user-id', workspaceId, { assetId: 'asset-id' }))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(setup({ role: 'viewer' }).service.register('user-id', workspaceId, { assetId: 'asset-id' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never changes or deletes system tracks', async () => {
    const system = { track: track({ scope: 'SYSTEM', workspaceId: null, assetId: null, createdBy: null }), role: null };
    const { service, audio, storage } = setup({ readable: system });

    await expect(service.updateMetadata('user-id', 'track-id', { title: 'Mine now' })).rejects.toMatchObject({ code: 'AUDIO_TRACK_READ_ONLY' });
    await expect(service.remove('user-id', 'track-id')).rejects.toMatchObject({ code: 'AUDIO_TRACK_READ_ONLY' });
    await expect(service.get('user-id', 'track-id')).resolves.toMatchObject({ scope: 'system' });
    expect(audio.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused workspace track together with its asset object', async () => {
    const { service, audio, assets, storage } = setup();

    await service.remove('user-id', 'track-id');
    expect(audio.delete).toHaveBeenCalledWith('track-id');
    expect(assets.updateState).toHaveBeenCalledWith('asset-id', 'DELETED');
    expect(storage.delete).toHaveBeenCalledWith('objects/song');
  });

  it('refuses to delete a track a project still uses', async () => {
    const { service, storage } = setup({ attachments: 1 });

    await expect(service.remove('user-id', 'track-id')).rejects.toMatchObject({ code: 'AUDIO_TRACK_IN_USE' });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('issues a short-lived signed read URL', async () => {
    await expect(setup({ role: 'viewer' }).service.createAccess('user-id', 'track-id'))
      .resolves.toEqual({ url: 'https://storage/signed', expiresIn: 300 });
  });
});

describe('AudioService generation', () => {
  it('attaches requested tracks and returns metadata only', async () => {
    const { service, audio } = setup();

    await expect(service.resolveGenerationAudio('user-id', 'project-id', [{ trackId: 'track-id' }])).resolves.toEqual([{
      trackId: 'track-id', title: 'Bright Future', artist: null, genre: 'electronic', moodTags: ['upbeat'], bpm: 120, durationMs: 32_000,
    }]);
    expect(audio.attach).toHaveBeenCalledWith('project-id', 'track-id', 'user-id');
  });

  it('allows system tracks in any project', async () => {
    const system = { track: track({ scope: 'SYSTEM', workspaceId: null, assetId: null }), role: null };
    await expect(setup({ readable: system }).service.resolveGenerationAudio('user-id', 'project-id', [{ trackId: 'track-id' }]))
      .resolves.toHaveLength(1);
  });

  it('rejects workspace tracks from another workspace', async () => {
    const foreign = { track: track({ workspaceId: otherWorkspaceId }), role: 'editor' };
    const { service, audio } = setup({ readable: foreign });

    await expect(service.resolveGenerationAudio('user-id', 'project-id', [{ trackId: 'track-id' }]))
      .rejects.toMatchObject({ code: 'AUDIO_TRACK_NOT_FOUND' });
    expect(audio.attach).not.toHaveBeenCalled();
  });

  it('carries attached tracks into later turns when none are requested', async () => {
    const { service, audio } = setup();

    await expect(service.resolveGenerationAudio('user-id', 'project-id', undefined)).resolves.toHaveLength(1);
    expect(audio.getReadableForUser).not.toHaveBeenCalled();
  });

  it('bounds and deduplicates requested tracks', async () => {
    const { service } = setup();
    const ids = ['a', 'b', 'c', 'd'].map((trackId) => ({ trackId }));

    await expect(service.resolveGenerationAudio('user-id', 'project-id', ids)).rejects.toMatchObject({ code: 'AUDIO_LIMIT_EXCEEDED' });
    await expect(service.resolveGenerationAudio('user-id', 'project-id', [{ trackId: 'a' }, { trackId: 'a' }]))
      .rejects.toMatchObject({ code: 'AUDIO_TRACK_DUPLICATE' });
  });
});
