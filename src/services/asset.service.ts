import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { PrivateObjectStorage } from '../../packages/object-storage/types.js';
import { validateAssetBuffer, validateAssetMetadata, validateStoredAsset } from '../../packages/object-storage/asset-validation.js';
import { inspectImage, toVisionImage } from '../../packages/object-storage/image-metadata.js';
import { AppError } from '../errors.js';
import type { AssetRecord, DatabaseAssetRepository } from '../repositories/asset.repository.js';
import type { WorkspaceRole } from './workspace.service.js';
import type { AssetAttachmentInput } from './generation.service.js';

export interface CreateAssetUploadInput {
  fileName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
}

export class AssetService {
  constructor(private readonly repository: DatabaseAssetRepository, private readonly storage: PrivateObjectStorage) {}

  async createUpload(userId: string, workspaceId: string, input: CreateAssetUploadInput) {
    const access = await this.repository.getWorkspaceAccess(workspaceId, userId);
    if (!access) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    requireWrite(access.role);
    try { validateAssetMetadata(input.fileName, input.contentType, input.byteSize); } catch (error) {
      throw new AppError(422, 'ASSET_METADATA_INVALID', error instanceof Error ? error.message : 'Asset metadata is invalid.');
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const assetId = randomUUID();
    const objectKey = `workspaces/${workspaceId}/assets/${assetId}/${randomUUID()}`;
    const asset = await this.repository.create({
      id: assetId,
      workspaceId, createdBy: userId, fileName: input.fileName, contentType: input.contentType,
      byteSize: input.byteSize, checksum: input.checksum.toLowerCase(), objectKey, uploadExpiresAt: expiresAt,
      storageProvider: this.storage.bucket === 'local' ? 'local' : 'supabase',
      storageBucket: this.storage.bucket ?? 'motify-assets',
    });
    const signed = await this.storage.createSignedUpload(objectKey);
    return {
      uploadId: asset.id,
      assetId: asset.id,
      uploadUrl: this.storage.bucket === 'local' ? `/v1/assets/uploads/${asset.id}/content` : signed.signedUrl,
      uploadToken: signed.token || null,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async upload(userId: string, uploadId: string, content: Readable, contentType: string) {
    const access = await this.repository.getForUser(uploadId, userId);
    if (!access) throw new AppError(404, 'ASSET_UPLOAD_NOT_FOUND', 'Asset upload not found.');
    requireWrite(access.role);
    if (!access.asset.uploadExpiresAt || access.asset.uploadExpiresAt.getTime() < Date.now()) {
      await this.repository.updateState(uploadId, 'FAILED');
      throw new AppError(410, 'ASSET_UPLOAD_EXPIRED', 'Asset upload expired.');
    }
    if (contentType !== access.asset.contentType) throw new AppError(422, 'ASSET_TYPE_MISMATCH', 'Uploaded asset type does not match the declared type.');
    let stored;
    try {
      stored = await this.storage.putStream(access.asset.objectKey, content, contentType, access.asset.byteSize);
    } catch (error) {
      if (error instanceof Error && error.message === 'Stored object exceeded its size limit.') {
        throw new AppError(422, 'ASSET_SIZE_MISMATCH', 'Uploaded asset size does not match the declared size.');
      }
      throw error;
    }
    if (stored.byteSize !== access.asset.byteSize || stored.checksum !== access.asset.checksum) {
      await this.storage.delete(stored.key);
      await this.repository.updateState(uploadId, 'FAILED');
      if (stored.byteSize !== access.asset.byteSize) throw new AppError(422, 'ASSET_SIZE_MISMATCH', 'Uploaded asset size does not match the declared size.');
      throw new AppError(422, 'ASSET_CHECKSUM_MISMATCH', 'Uploaded asset checksum does not match.');
    }
    try {
      await validateStoredAsset(await this.storage.resolvePath(stored.key), contentType);
    } catch {
      await this.storage.delete(stored.key);
      await this.repository.updateState(uploadId, 'FAILED');
      throw new AppError(422, 'ASSET_CONTENT_INVALID', 'Uploaded asset bytes do not match an allowed safe asset type.');
    }
    return { uploaded: true };
  }

  async complete(userId: string, workspaceId: string, uploadId: string) {
    const access = await this.repository.getForCompletion(uploadId, userId);
    if (!access || access.asset.workspaceId !== workspaceId) throw new AppError(404, 'ASSET_UPLOAD_NOT_FOUND', 'Asset upload not found.');
    requireWrite(access.role);
    if (access.asset.state === 'READY') return toAssetResource(access.asset);
    let content: Buffer;
    try {
      const stream = await this.storage.openRead(access.asset.objectKey);
      content = await readBounded(stream, access.asset.byteSize + 1);
    } catch {
      throw new AppError(409, 'ASSET_NOT_UPLOADED', 'Asset content has not been uploaded.');
    }
    const integrity = { byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex') };
    if (integrity.byteSize !== access.asset.byteSize || integrity.checksum !== access.asset.checksum) {
      throw new AppError(409, 'ASSET_UPLOAD_INCOMPLETE', 'Asset content has not finished uploading or failed integrity verification.');
    }
    let dimensions: { width: number; height: number };
    try {
      validateAssetBuffer(content, access.asset.contentType);
      dimensions = await inspectImage(content, access.asset.contentType);
    } catch {
      await this.storage.delete(access.asset.objectKey).catch(() => undefined);
      await this.repository.updateState(uploadId, 'FAILED');
      throw new AppError(422, 'ASSET_CONTENT_INVALID', 'Uploaded asset bytes do not match an allowed safe asset type.');
    }
    const asset = await this.repository.markReady(uploadId, dimensions);
    return toAssetResource(asset!);
  }

  async list(userId: string, workspaceId: string, page: number, pageSize: number, query?: string) {
    if (!(await this.repository.getWorkspaceAccess(workspaceId, userId))) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    const result = await this.repository.list(workspaceId, page, pageSize, query);
    return { data: result.data.map(toAssetResource), pagination: { page, pageSize, totalItems: result.totalItems, totalPages: Math.ceil(result.totalItems / pageSize) } };
  }

  async get(userId: string, assetId: string) {
    const access = await this.repository.getReadableForUser(assetId, userId);
    if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    return toAssetResource(access.asset);
  }

  async download(userId: string, assetId: string) {
    const access = await this.repository.getReadableForUser(assetId, userId);
    if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    const base = { contentType: access.asset.contentType, fileName: access.asset.fileName };
    if (this.storage.bucket === 'local') {
      return { ...base, kind: 'file' as const, path: await this.storage.resolvePath(access.asset.objectKey) };
    }
    return { ...base, kind: 'redirect' as const, url: await this.storage.createSignedReadUrl(access.asset.objectKey, 300) };
  }

  async updateMetadata(userId: string, assetId: string, input: { label?: string | null; tags?: string[] }) {
    const access = await this.repository.getReadableForUser(assetId, userId);
    if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    requireWrite(access.role);
    const asset = await this.repository.updateMetadata(assetId, input);
    if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    return toAssetResource(asset);
  }

  async remove(userId: string, assetId: string) {
    const access = await this.repository.getReadableForUser(assetId, userId);
    if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    requireWrite(access.role);
    if (await this.repository.countAttachments(assetId)) {
      throw new AppError(409, 'ASSET_IN_USE', 'Detach this asset from every project before deleting it.');
    }
    await this.repository.updateState(assetId, 'DELETED');
    await this.storage.delete(access.asset.objectKey);
  }

  async attach(userId: string, projectId: string, assetId: string, role: 'reference' | 'asset') {
    const project = await this.repository.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    requireWrite(project.role);
    const asset = await this.repository.getReadableForUser(assetId, userId);
    if (!asset || asset.asset.workspaceId !== project.project.workspaceId) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    await this.repository.attach(projectId, assetId, userId, role === 'reference' ? 'REFERENCE' : 'ASSET');
  }

  async detach(userId: string, projectId: string, assetId: string) {
    const project = await this.repository.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    requireWrite(project.role);
    await this.repository.detach(projectId, assetId);
  }

  async listProjectAssets(userId: string, projectId: string) {
    const project = await this.repository.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    return (await this.repository.listAttached(projectId)).map((entry) => ({
      ...toAssetResource(entry.asset),
      role: entry.role === 'REFERENCE' ? 'reference' as const : 'asset' as const,
      token: entry.role === 'ASSET' ? `motify-asset://${entry.asset.id}` : null,
    }));
  }

  async createAccess(userId: string, assetId: string) {
    const access = await this.repository.getReadableForUser(assetId, userId);
    if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    const expiresIn = 300;
    const url = this.storage.bucket === 'local'
      ? `/v1/assets/${assetId}/download`
      : await this.storage.createSignedReadUrl(access.asset.objectKey, expiresIn);
    return { url, expiresIn };
  }

  async resolveGenerationAssets(
    userId: string,
    projectId: string,
    requested: readonly AssetAttachmentInput[] | undefined,
  ) {
    const project = await this.repository.getProjectAccess(projectId, userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    requireWrite(project.role);
    if ((requested?.length ?? 0) > 10) throw new AppError(422, 'ASSET_LIMIT_EXCEEDED', 'A generation can use at most 10 images.');
    if (requested && new Set(requested.map((entry) => entry.assetId)).size !== requested.length) {
      throw new AppError(422, 'ASSET_METADATA_INVALID', 'Each generation asset may appear only once.');
    }

    const selected = requested
      ? await Promise.all(requested.map(async (entry) => {
          const access = await this.repository.getReadableForUser(entry.assetId, userId);
          if (!access || access.asset.workspaceId !== project.project.workspaceId) {
            throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
          }
          await this.repository.attach(projectId, entry.assetId, userId, entry.role === 'reference' ? 'REFERENCE' : 'ASSET');
          return { asset: access.asset, role: entry.role };
        }))
      : (await this.repository.listAttached(projectId)).map((entry) => ({
          asset: entry.asset,
          role: entry.role === 'REFERENCE' ? 'reference' as const : 'asset' as const,
        }));

    let totalBytes = 0;
    return Promise.all(selected.map(async ({ asset, role }) => {
      totalBytes += asset.byteSize;
      if (totalBytes > 30_000_000) throw new AppError(422, 'ASSET_LIMIT_EXCEEDED', 'Generation images are limited to 30 MB total.');
      const content = await readBounded(await this.storage.openRead(asset.objectKey), asset.byteSize);
      const vision = await toVisionImage(content, asset.contentType);
      return {
        assetId: asset.id,
        fileName: asset.fileName,
        mediaType: vision.contentType,
        dataBase64: vision.bytes.toString('base64'),
        role,
      };
    }));
  }
}

function requireWrite(role: WorkspaceRole) {
  if (role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.');
}

async function readBounded(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteSize += bytes.byteLength;
    if (byteSize > maxBytes) throw new Error('Stored object exceeded its size limit.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function toAssetResource(asset: AssetRecord) {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    state: asset.state,
    fileName: asset.fileName,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    checksum: asset.checksum,
    label: asset.label,
    tags: asset.tags,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
    downloadUrl: asset.state === 'READY' ? `/v1/assets/${asset.id}/download` : null,
  };
}
