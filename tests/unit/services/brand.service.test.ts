import { describe, expect, it, vi } from 'vitest';

import { BrandService } from '../../../src/services/brand.service.js';
import { readBrandDna } from '../../../packages/brand/brand-dna.js';

const workspaceId = '00000000-0000-4000-8000-000000000002';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000009';
const userId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000004';
const now = new Date('2026-09-30T10:00:00Z');

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brand-id', workspaceId, schemaVersion: 1, dna: {}, provenance: {}, revision: 1, updatedBy: userId,
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId, workspaceId, fileName: 'logo.svg', contentType: 'image/svg+xml', byteSize: 10, width: 400, height: 120, ...overrides,
  };
}

function setup(options: { role?: string | null; profile?: unknown; asset?: Record<string, unknown> | null; saved?: unknown; linked?: boolean } = {}) {
  const repository = {
    getWorkspaceAccess: vi.fn().mockResolvedValue(options.role === null ? null : { role: options.role ?? 'editor' }),
    getProfile: vi.fn().mockResolvedValue(options.profile === undefined ? profile() : options.profile),
    ensureProfile: vi.fn().mockResolvedValue(profile()),
    saveProfile: vi.fn().mockImplementation(async (_workspace: string, revision: number, input: object) => (
      options.saved === undefined ? profile({ ...input, revision: revision + 1 }) : options.saved
    )),
    listAssets: vi.fn().mockResolvedValue([]),
    getAsset: vi.fn().mockResolvedValue(options.linked === false ? null : { assetId }),
    putAsset: vi.fn().mockResolvedValue({ replaced: ['old-logo'] }),
    updateAsset: vi.fn().mockResolvedValue({ replaced: [] }),
    removeAsset: vi.fn(),
  };
  const assets = {
    getReadableForUser: vi.fn().mockResolvedValue(options.asset === null ? null : { asset: asset(options.asset) }),
  };
  const remover = { remove: vi.fn().mockResolvedValue(undefined) };
  const service = new BrandService(repository as never, assets as never, remover, () => now);
  return { service, repository, assets, remover };
}

describe('BrandService', () => {
  it('returns an empty brand at revision 0 before anything is saved', async () => {
    const { service } = setup({ profile: null });
    const brand = await service.get(userId, workspaceId);
    expect(brand).toMatchObject({ revision: 0, updatedAt: null, assets: [] });
    expect(brand.dna.identity.name).toBe('');
  });

  it('hides workspaces the user is not a member of', async () => {
    const { service } = setup({ role: null });
    await expect(service.get(userId, workspaceId)).rejects.toMatchObject({ status: 404, code: 'WORKSPACE_NOT_FOUND' });
  });

  it('saves against the current revision and records manual provenance', async () => {
    const { service, repository } = setup();
    const result = await service.update(userId, workspaceId, { revision: 1, dna: readBrandDna({ identity: { name: 'Acme' } }) });

    expect(repository.saveProfile).toHaveBeenCalledWith(workspaceId, 1, expect.objectContaining({
      provenance: { 'identity.name': { source: 'manual', updatedAt: now.toISOString() } },
      updatedBy: userId,
    }));
    expect(result.revision).toBe(2);
    expect(result.dna.identity.name).toBe('Acme');
  });

  it('rejects a stale revision and viewers', async () => {
    await expect(setup().service.update(userId, workspaceId, { revision: 0, dna: readBrandDna({}) }))
      .rejects.toMatchObject({ status: 409, code: 'BRAND_REVISION_CONFLICT', details: { currentRevision: 1 } });
    await expect(setup({ saved: null }).service.update(userId, workspaceId, { revision: 1, dna: readBrandDna({}) }))
      .rejects.toMatchObject({ status: 409 });
    await expect(setup({ role: 'viewer' }).service.update(userId, workspaceId, { revision: 1, dna: readBrandDna({}) }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('links an image and cleans up the logo it replaced', async () => {
    const { service, repository, remover } = setup();
    await service.addAsset(userId, workspaceId, { assetId, role: 'logo' });

    expect(repository.putAsset).toHaveBeenCalledWith(expect.objectContaining({ brandId: 'brand-id', assetId, role: 'LOGO', source: 'MANUAL' }));
    expect(remover.remove).toHaveBeenCalledWith(userId, 'old-logo');
  });

  it('links font files only as fonts, and images never as fonts', async () => {
    const { service, repository } = setup({ asset: { contentType: 'font/woff2', fileName: 'Acme.woff2' } });
    await service.addAsset(userId, workspaceId, { assetId, role: 'font' });
    expect(repository.putAsset).toHaveBeenCalledWith(expect.objectContaining({ role: 'FONT' }));

    await expect(setup({ asset: { contentType: 'font/woff2' } }).service.addAsset(userId, workspaceId, { assetId, role: 'logo' }))
      .rejects.toMatchObject({ status: 422, code: 'ASSET_KIND_UNSUPPORTED' });
    await expect(setup().service.addAsset(userId, workspaceId, { assetId, role: 'font' }))
      .rejects.toMatchObject({ status: 422, code: 'ASSET_KIND_UNSUPPORTED' });
  });

  it('rejects fonts pointing at files the brand does not hold, and releases files a save removed', async () => {
    const withFont = (ids: string[]) => readBrandDna({ visual: { fonts: [{ id: 'f', family: 'Acme', source: 'upload', files: ids.map((id) => ({ assetId: id })) }] } });
    const fontLink = (id: string) => ({ link: { role: 'FONT', label: null, source: 'MANUAL', sourceUrl: null, createdAt: now }, asset: asset({ id, contentType: 'font/woff2' }) });
    const kept = '00000000-0000-4000-8000-0000000000f1';
    const removed = '00000000-0000-4000-8000-0000000000f2';

    const stranger = setup();
    await expect(stranger.service.update(userId, workspaceId, { revision: 1, dna: withFont([kept]) }))
      .rejects.toMatchObject({ status: 422, code: 'BRAND_FONT_NOT_FOUND' });

    const { service, repository, remover } = setup({ profile: profile({ dna: withFont([kept, removed]) }) });
    repository.listAssets.mockResolvedValue([fontLink(kept), fontLink(removed)]);
    await service.update(userId, workspaceId, { revision: 1, dna: withFont([kept]) });
    expect(repository.removeAsset).toHaveBeenCalledWith('brand-id', removed);
    expect(remover.remove).toHaveBeenCalledWith(userId, removed);
    expect(remover.remove).not.toHaveBeenCalledWith(userId, kept);
  });

  it('refuses audio and images from another workspace', async () => {
    await expect(setup({ asset: { contentType: 'audio/mpeg' } }).service.addAsset(userId, workspaceId, { assetId, role: 'image' }))
      .rejects.toMatchObject({ status: 422, code: 'ASSET_KIND_UNSUPPORTED' });
    await expect(setup({ asset: { workspaceId: otherWorkspaceId } }).service.addAsset(userId, workspaceId, { assetId, role: 'image' }))
      .rejects.toMatchObject({ status: 404, code: 'ASSET_NOT_FOUND' });
  });

  it('removes a linked image and its file, but only if it belongs to the brand', async () => {
    const { service, repository, remover } = setup();
    await service.removeAsset(userId, workspaceId, assetId);
    expect(repository.removeAsset).toHaveBeenCalledWith('brand-id', assetId);
    expect(remover.remove).toHaveBeenCalledWith(userId, assetId);

    await expect(setup({ linked: false }).service.removeAsset(userId, workspaceId, assetId))
      .rejects.toMatchObject({ status: 404, code: 'BRAND_ASSET_NOT_FOUND' });
  });

  it('merges Site Intelligence findings without touching manual fields', async () => {
    const { service, repository } = setup({
      profile: profile({ dna: { identity: { name: 'Acme' } }, provenance: { 'identity.name': { source: 'manual', updatedAt: 'x' } } }),
    });
    const result = await service.applySuggestion(workspaceId, { 'identity.name': 'ACME', 'identity.tagline': 'Ship faster' }, { source: 'site_intelligence' });

    expect(result).toEqual({ applied: ['identity.tagline'], skipped: ['identity.name'], revision: 2 });
    expect(repository.saveProfile).toHaveBeenCalledWith(workspaceId, 1, expect.objectContaining({ updatedBy: null }));
  });

  it('gives generations nothing for a blank brand, and the document plus images otherwise', async () => {
    expect(await setup({ profile: null }).service.resolveGenerationBrand(workspaceId)).toBeUndefined();
    expect(await setup().service.resolveGenerationBrand(workspaceId)).toBeUndefined();

    const { service, repository } = setup({ profile: profile({ dna: { identity: { name: 'Acme' } } }) });
    repository.listAssets.mockResolvedValue([{ link: { role: 'LOGO', label: null }, asset: asset() }]);
    expect(await service.resolveGenerationBrand(workspaceId)).toMatchObject({
      dna: { identity: { name: 'Acme' } },
      assets: [{ assetId, role: 'logo', fileName: 'logo.svg', width: 400 }],
    });
  });
});
