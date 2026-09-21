import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import type { DatabaseAssetRepository } from '../../../src/repositories/asset.repository.js';
import { AssetService } from '../../../src/services/asset.service.js';
import { LocalFilesystemObjectStorage } from '../../../packages/object-storage/local-filesystem.js';
import { wavBytes } from '../object-storage/wav.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('AssetService completion', () => {
  it('re-verifies stored size and checksum before changing an upload to READY', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-complete-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const bytes = await pngBytes();
    const stored = await storage.putBuffer('workspace/assets/upload', bytes, 'image/png');
    const repository = fakeRepository({ byteSize: stored.byteSize + 1, checksum: stored.checksum, objectKey: stored.key });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).rejects.toMatchObject({ code: 'ASSET_UPLOAD_INCOMPLETE' });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it('marks a fully verified safe asset READY', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-ready-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const bytes = await pngBytes();
    const stored = await storage.putBuffer('workspace/assets/upload', bytes, 'image/png');
    const repository = fakeRepository({ byteSize: stored.byteSize, checksum: stored.checksum, objectKey: stored.key });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({ state: 'READY' });
    expect(repository.markReady).toHaveBeenCalledWith('asset-id', { width: 2, height: 2 });
  });

  it('returns an already-ready asset when completion is retried', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-retry-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const repository = fakeRepository({ byteSize: 8, checksum: '0'.repeat(64), objectKey: 'missing/not-needed' }, 'READY');
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({ state: 'READY' });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it('does not complete an upload through a different workspace route', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-workspace-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const repository = fakeRepository({ byteSize: 8, checksum: '0'.repeat(64), objectKey: 'missing/not-needed' });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'different-workspace', 'asset-id')).rejects.toMatchObject({ code: 'ASSET_UPLOAD_NOT_FOUND', status: 404 });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it('completes an image from remote object storage without a filesystem path', async () => {
    const bytes = await pngBytes();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const repository = fakeRepository({ byteSize: bytes.byteLength, checksum, objectKey: 'workspaces/ws/assets/a/object' });
    const storage = {
      openRead: vi.fn().mockResolvedValue(Readable.from(bytes)),
      delete: vi.fn(),
    };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({
      state: 'READY',
      width: 2,
      height: 2,
    });
  });
});

describe('AssetService upload reservation', () => {
  it('reserves an immutable object key and returns signed upload information', async () => {
    const repository = {
      getWorkspaceAccess: vi.fn().mockResolvedValue({ role: 'editor' }),
      create: vi.fn().mockImplementation(async (input) => ({ ...input, state: 'PENDING', createdAt: new Date(), updatedAt: new Date() })),
    };
    const storage = {
      bucket: 'motify-assets',
      createSignedUpload: vi.fn().mockImplementation(async (key: string) => ({ key, token: 'signed-token', signedUrl: 'https://storage/upload' })),
    };
    const service = new AssetService(repository as never, storage as never);
    const bytes = await pngBytes();

    const result = await service.createUpload('user-id', 'workspace-id', {
      fileName: 'logo.png',
      contentType: 'image/png',
      byteSize: bytes.byteLength,
      checksum: 'a'.repeat(64),
    });

    expect(result).toMatchObject({ uploadId: expect.any(String), assetId: expect.any(String), uploadToken: 'signed-token', uploadUrl: 'https://storage/upload' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      id: result.assetId,
      workspaceId: 'workspace-id',
      storageBucket: 'motify-assets',
      objectKey: expect.stringContaining(`/assets/${result.assetId}/`),
    }));
  });
});

describe('AssetService generation inputs', () => {
  it('authorizes, attaches, and converts classified images for the model', async () => {
    const bytes = await pngBytes();
    const asset = {
      id: '11111111-1111-4111-8111-111111111111', workspaceId: 'workspace-id', createdBy: 'user-id', state: 'READY',
      fileName: 'logo.png', label: null, tags: [], contentType: 'image/png', byteSize: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'), width: 2, height: 2,
      storageProvider: 'supabase', storageBucket: 'motify-assets', objectKey: 'workspaces/ws/assets/a/object',
      uploadExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const repository = {
      getProjectAccess: vi.fn().mockResolvedValue({ project: { id: 'project-id', workspaceId: 'workspace-id' }, role: 'editor' }),
      getReadableForUser: vi.fn().mockResolvedValue({ asset, role: 'editor' }),
      attach: vi.fn(),
    };
    const storage = { openRead: vi.fn().mockResolvedValue(Readable.from(bytes)) };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.resolveGenerationAssets('user-id', 'project-id', [
      { assetId: asset.id, role: 'reference' },
    ])).resolves.toEqual([expect.objectContaining({
      assetId: asset.id, fileName: 'logo.png', mediaType: 'image/png', role: 'reference', dataBase64: expect.any(String),
    })]);
    expect(repository.attach).toHaveBeenCalledWith('project-id', asset.id, 'user-id', 'REFERENCE');
  });
});

describe('AssetService read access', () => {
  it('uses the authenticated download route for local development storage', async () => {
    const asset = { id: 'asset-id', objectKey: 'workspaces/ws/assets/a/object' };
    const repository = { getReadableForUser: vi.fn().mockResolvedValue({ asset, role: 'viewer' }) };
    const storage = { bucket: 'local', createSignedReadUrl: vi.fn() };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.createAccess('user-id', 'asset-id')).resolves.toEqual({
      url: '/v1/assets/asset-id/download',
      expiresIn: 300,
    });
    expect(storage.createSignedReadUrl).not.toHaveBeenCalled();
  });

  it('returns a short-lived signed URL only after workspace authorization', async () => {
    const asset = { id: 'asset-id', objectKey: 'workspaces/ws/assets/a/object' };
    const repository = { getReadableForUser: vi.fn().mockResolvedValue({ asset, role: 'viewer' }) };
    const storage = { createSignedReadUrl: vi.fn().mockResolvedValue('https://storage/read') };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.createAccess('user-id', 'asset-id')).resolves.toEqual({
      url: 'https://storage/read',
      expiresIn: 300,
    });
    expect(storage.createSignedReadUrl).toHaveBeenCalledWith(asset.objectKey, 300);
  });

  it('returns a signed download URL for remote object storage', async () => {
    const asset = {
      id: 'asset-id', objectKey: 'workspaces/ws/assets/a/object',
      contentType: 'image/png', fileName: 'logo.png',
    };
    const repository = { getReadableForUser: vi.fn().mockResolvedValue({ asset, role: 'viewer' }) };
    const storage = {
      bucket: 'motify-assets',
      createSignedReadUrl: vi.fn().mockResolvedValue('https://storage/download'),
    };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.download('user-id', 'asset-id')).resolves.toEqual({
      kind: 'redirect',
      url: 'https://storage/download',
      contentType: 'image/png',
      fileName: 'logo.png',
    });
  });
});

describe('AssetService library management', () => {
  const readyAsset = {
    id: 'asset-id', workspaceId: 'workspace-id', createdBy: 'user-id', state: 'READY',
    fileName: 'logo.png', label: 'Primary logo', tags: ['brand'], contentType: 'image/png',
    byteSize: 12, checksum: 'a'.repeat(64), width: 2, height: 2, storageProvider: 'supabase',
    storageBucket: 'motify-assets', objectKey: 'workspaces/ws/assets/a/object', uploadExpiresAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  it('passes bounded metadata search to the repository', async () => {
    const repository = {
      getWorkspaceAccess: vi.fn().mockResolvedValue({ role: 'viewer' }),
      list: vi.fn().mockResolvedValue({ data: [readyAsset], totalItems: 1 }),
    };
    const service = new AssetService(repository as never, {} as never);

    await expect(service.list('user-id', 'workspace-id', 1, 20, 'brand')).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'asset-id', label: 'Primary logo', tags: ['brand'] })],
    });
    expect(repository.list).toHaveBeenCalledWith('workspace-id', 1, 20, 'brand');
  });

  it('allows editors to update manual labels and tags', async () => {
    const repository = {
      getReadableForUser: vi.fn().mockResolvedValue({ asset: readyAsset, role: 'editor' }),
      updateMetadata: vi.fn().mockResolvedValue({ ...readyAsset, label: 'Wordmark', tags: ['brand', 'dark'] }),
    };
    const service = new AssetService(repository as never, {} as never);

    await expect(service.updateMetadata('user-id', 'asset-id', {
      label: 'Wordmark', tags: ['brand', 'dark'],
    })).resolves.toMatchObject({ label: 'Wordmark', tags: ['brand', 'dark'] });
  });

  it('does not delete an asset still attached to a project', async () => {
    const repository = {
      getReadableForUser: vi.fn().mockResolvedValue({ asset: readyAsset, role: 'owner' }),
      countAttachments: vi.fn().mockResolvedValue(1),
      updateState: vi.fn(),
    };
    const storage = { delete: vi.fn() };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.remove('user-id', 'asset-id')).rejects.toMatchObject({ code: 'ASSET_IN_USE', status: 409 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('lists project attachments with stable tokens only for placeable assets', async () => {
    const repository = {
      getProjectAccess: vi.fn().mockResolvedValue({ project: { workspaceId: 'workspace-id' }, role: 'viewer' }),
      listAttached: vi.fn().mockResolvedValue([
        { asset: readyAsset, role: 'ASSET' },
        { asset: { ...readyAsset, id: 'reference-id' }, role: 'REFERENCE' },
      ]),
    };
    const service = new AssetService(repository as never, {} as never);

    await expect(service.listProjectAssets('user-id', 'project-id')).resolves.toEqual([
      expect.objectContaining({ id: 'asset-id', role: 'asset', token: 'motify-asset://asset-id' }),
      expect.objectContaining({ id: 'reference-id', role: 'reference', token: null }),
    ]);
  });
});

async function pngBytes() {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: '#7c3aed' } }).png().toBuffer();
}

function fakeRepository(
  integrity: { byteSize: number; checksum: string; objectKey: string },
  initialState: 'PENDING' | 'READY' = 'PENDING',
  overrides: { contentType?: string; fileName?: string } = {},
) {
  const asset = {
    id: 'asset-id',
    workspaceId: 'workspace-id',
    createdBy: 'user-id',
    state: initialState,
    fileName: 'image.png',
    contentType: 'image/png',
    label: null,
    tags: [],
    width: null,
    height: null,
    storageProvider: 'local',
    storageBucket: 'local',
    ...integrity,
    ...overrides,
    uploadExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    getForCompletion: vi.fn().mockResolvedValue({ asset, role: 'owner' }),
    updateState: vi.fn(),
    markReady: vi.fn().mockImplementation(async (_id: string, metadata: object) => ({ ...asset, ...metadata, state: 'READY' })),
  };
}

describe('AssetService audio', () => {
  it('records the duration of verified audio instead of image dimensions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-audio-ready-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const stored = await storage.putBuffer('workspace/assets/song', wavBytes(2), 'audio/wav');
    const repository = fakeRepository(
      { byteSize: stored.byteSize, checksum: stored.checksum, objectKey: stored.key },
      'PENDING',
      { contentType: 'audio/wav', fileName: 'song.wav' },
    );
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({ state: 'READY', durationMs: 2000 });
    expect(repository.markReady).toHaveBeenCalledWith('asset-id', { durationMs: 2000 });
  });

  it('keeps audio out of project image attachments and the vision path', async () => {
    const audio = { id: 'audio-id', workspaceId: 'workspace-id', contentType: 'audio/mpeg', byteSize: 10, objectKey: 'k', fileName: 'a.mp3' };
    const repository = {
      getProjectAccess: vi.fn().mockResolvedValue({ project: { id: 'project-id', workspaceId: 'workspace-id' }, role: 'editor' }),
      getReadableForUser: vi.fn().mockResolvedValue({ asset: audio, role: 'editor' }),
      listAttached: vi.fn().mockResolvedValue([{ asset: audio, role: 'ASSET' }]),
      attach: vi.fn(),
    };
    const storage = { openRead: vi.fn() };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.attach('user-id', 'project-id', 'audio-id', 'asset')).rejects.toMatchObject({ code: 'ASSET_KIND_UNSUPPORTED' });
    await expect(service.resolveGenerationAssets('user-id', 'project-id', [{ assetId: 'audio-id', role: 'asset' }]))
      .rejects.toMatchObject({ code: 'ASSET_KIND_UNSUPPORTED' });
    await expect(service.resolveGenerationAssets('user-id', 'project-id', undefined)).resolves.toEqual([]);
    expect(repository.attach).not.toHaveBeenCalled();
    expect(storage.openRead).not.toHaveBeenCalled();
  });

  it('refuses to delete an asset that backs a music library track', async () => {
    const repository = {
      getReadableForUser: vi.fn().mockResolvedValue({ asset: { id: 'audio-id', objectKey: 'k' }, role: 'owner' }),
      countAttachments: vi.fn().mockResolvedValue(0),
      isAudioTrack: vi.fn().mockResolvedValue(true),
      updateState: vi.fn(),
    };
    const storage = { delete: vi.fn() };
    const service = new AssetService(repository as never, storage as never);

    await expect(service.remove('user-id', 'audio-id')).rejects.toMatchObject({ code: 'ASSET_IN_USE' });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
