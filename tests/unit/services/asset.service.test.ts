import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseAssetRepository } from '../../../src/repositories/asset.repository.js';
import { AssetService } from '../../../src/services/asset.service.js';
import { LocalFilesystemObjectStorage } from '../../../packages/object-storage/local-filesystem.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('AssetService completion', () => {
  it('re-verifies stored size and checksum before changing an upload to READY', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-complete-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const stored = await storage.putBuffer('workspace/assets/upload', bytes, 'image/png');
    const repository = fakeRepository({ byteSize: stored.byteSize + 1, checksum: stored.checksum, objectKey: stored.key });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).rejects.toMatchObject({ code: 'ASSET_UPLOAD_INCOMPLETE' });
    expect(repository.updateState).not.toHaveBeenCalled();
  });

  it('marks a fully verified safe asset READY', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-ready-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const stored = await storage.putBuffer('workspace/assets/upload', bytes, 'image/png');
    const repository = fakeRepository({ byteSize: stored.byteSize, checksum: stored.checksum, objectKey: stored.key });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({ state: 'READY' });
    expect(repository.updateState).toHaveBeenCalledWith('asset-id', 'READY');
  });

  it('returns an already-ready asset when completion is retried', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-retry-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const repository = fakeRepository({ byteSize: 8, checksum: '0'.repeat(64), objectKey: 'missing/not-needed' }, 'READY');
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'workspace-id', 'asset-id')).resolves.toMatchObject({ state: 'READY' });
    expect(repository.updateState).not.toHaveBeenCalled();
  });

  it('does not complete an upload through a different workspace route', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-asset-workspace-'));
    temporaryDirectories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(root);
    const repository = fakeRepository({ byteSize: 8, checksum: '0'.repeat(64), objectKey: 'missing/not-needed' });
    const service = new AssetService(repository as unknown as DatabaseAssetRepository, storage);

    await expect(service.complete('user-id', 'different-workspace', 'asset-id')).rejects.toMatchObject({ code: 'ASSET_UPLOAD_NOT_FOUND', status: 404 });
    expect(repository.updateState).not.toHaveBeenCalled();
  });
});

function fakeRepository(integrity: { byteSize: number; checksum: string; objectKey: string }, initialState: 'PENDING' | 'READY' = 'PENDING') {
  const asset = {
    id: 'asset-id',
    workspaceId: 'workspace-id',
    createdBy: 'user-id',
    state: initialState,
    fileName: 'image.png',
    contentType: 'image/png',
    ...integrity,
    uploadExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    getForCompletion: vi.fn().mockResolvedValue({ asset, role: 'owner' }),
    updateState: vi.fn().mockImplementation(async (_id: string, state: 'READY') => ({ ...asset, state })),
  };
}
