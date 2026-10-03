import {
  applyBrandEdit,
  brandFontAssetIds,
  BRAND_DNA_SCHEMA_VERSION,
  emptyBrandDna,
  isBrandDnaEmpty,
  mergeBrandSuggestion,
  readBrandDna,
  readBrandProvenance,
  type BrandAssetRole,
  type BrandDna,
  type BrandSuggestion,
  type BrandSuggestionOptions,
} from '../../packages/brand/brand-dna.js';
import type { GenerationBrand } from '../../packages/ai/agent/dependencies.js';
import { assetKind } from '../../packages/object-storage/asset-validation.js';
import { AppError } from '../errors.js';
import type {
  AssetRow,
  BrandAssetRecord,
  BrandAssetRoleValue,
  BrandProfileRecord,
  DatabaseBrandRepository,
} from '../repositories/brand.repository.js';
import type { WorkspaceRole } from './workspace.service.js';

export type BrandRepository = Pick<DatabaseBrandRepository,
  'getWorkspaceAccess' | 'getPersonalWorkspaceId' | 'getProfile' | 'ensureProfile' | 'saveProfile' | 'listAssets' | 'getAsset' | 'putAsset' | 'updateAsset' | 'removeAsset'>;

/** Reads the uploaded asset a brand link points at. */
export interface BrandAssetReader {
  getReadableForUser(assetId: string, userId: string): Promise<{ asset: AssetRow } | null>;
}

/** Deletes an asset's file once nothing uses it. Refuses (ASSET_IN_USE) while a project still does. */
export interface BrandAssetRemover {
  remove(userId: string, assetId: string): Promise<void>;
}

export interface UpdateBrandInput {
  revision: number;
  dna: BrandDna;
}

export interface AddBrandAssetInput {
  assetId: string;
  role: BrandAssetRole;
  label?: string | null;
}

const MAX_BRAND_ASSETS = 40;

/**
 * Brand DNA. Each person has one brand, kept in their personal workspace, and
 * every generation they run is given it whichever workspace the project lives
 * in. The workspace-scoped methods remain for workspaces that saved a brand
 * before it followed the person. The document is written against a revision
 * so two tabs cannot silently overwrite each other.
 */
export class BrandService {
  constructor(
    private readonly repository: BrandRepository,
    private readonly assets: BrandAssetReader,
    private readonly remover?: BrandAssetRemover,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The workspace that holds this person's brand. */
  async brandWorkspaceId(userId: string) {
    const workspaceId = await this.repository.getPersonalWorkspaceId(userId);
    if (!workspaceId) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return workspaceId;
  }

  async get(userId: string, workspaceId: string) {
    await this.requireMember(workspaceId, userId);
    const profile = await this.repository.getProfile(workspaceId);
    return this.toResource(workspaceId, profile, profile ? await this.repository.listAssets(profile.id) : []);
  }

  async update(userId: string, workspaceId: string, input: UpdateBrandInput) {
    requireWrite((await this.requireMember(workspaceId, userId)).role);
    const current = await this.repository.getProfile(workspaceId);
    const currentRevision = current?.revision ?? 0;
    if (input.revision !== currentRevision) throw conflict(currentRevision);

    const previous = current ? readBrandDna(current.dna) : emptyBrandDna();
    // A font may only point at font files this brand holds.
    const linkedFonts = new Set(current
      ? (await this.repository.listAssets(current.id)).filter(({ link }) => link.role === 'FONT').map(({ asset }) => asset.id)
      : []);
    const unknown = brandFontAssetIds(input.dna).filter((assetId) => !linkedFonts.has(assetId));
    if (unknown.length > 0) {
      throw new AppError(422, 'BRAND_FONT_NOT_FOUND', 'A font file is not part of this brand. Upload it again.', { assetIds: unknown });
    }

    const edit = applyBrandEdit(previous, readBrandProvenance(current?.provenance), input.dna, this.now());
    const saved = await this.repository.saveProfile(workspaceId, currentRevision, {
      dna: edit.dna,
      provenance: edit.provenance,
      schemaVersion: BRAND_DNA_SCHEMA_VERSION,
      updatedBy: userId,
    });
    if (!saved) throw conflict((await this.repository.getProfile(workspaceId))?.revision ?? 0);

    // Font files the person removed in this edit go with it. Only files the
    // previous version used are considered, so an upload still in flight
    // (linked, but not yet in any saved document) is never swept away.
    const kept = new Set(brandFontAssetIds(edit.dna));
    const dropped = brandFontAssetIds(previous).filter((assetId) => !kept.has(assetId));
    for (const assetId of dropped) await this.repository.removeAsset(saved.id, assetId);
    await this.release(userId, dropped);
    return this.toResource(workspaceId, saved, await this.repository.listAssets(saved.id));
  }

  async addAsset(userId: string, workspaceId: string, input: AddBrandAssetInput) {
    requireWrite((await this.requireMember(workspaceId, userId)).role);
    const access = await this.assets.getReadableForUser(input.assetId, userId);
    if (!access || access.asset.workspaceId !== workspaceId) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    requireKindForRole(access.asset.contentType, input.role);
    const profile = await this.repository.ensureProfile(workspaceId, userId);
    const existing = await this.repository.listAssets(profile.id);
    if (existing.length >= MAX_BRAND_ASSETS && !existing.some((entry) => entry.asset.id === input.assetId)) {
      throw new AppError(422, 'BRAND_ASSET_LIMIT', `Brand DNA holds at most ${MAX_BRAND_ASSETS} files.`);
    }
    const { replaced } = await this.repository.putAsset({
      brandId: profile.id,
      assetId: input.assetId,
      role: toRoleValue(input.role),
      label: input.label ?? null,
      source: 'MANUAL',
      sourceUrl: null,
      addedBy: userId,
    });
    await this.release(userId, replaced);
    return this.get(userId, workspaceId);
  }

  async updateAsset(userId: string, workspaceId: string, assetId: string, input: { role?: BrandAssetRole; label?: string | null }) {
    requireWrite((await this.requireMember(workspaceId, userId)).role);
    const profile = await this.requireLinkedAsset(workspaceId, assetId);
    if (input.role) {
      const access = await this.assets.getReadableForUser(assetId, userId);
      if (!access) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
      requireKindForRole(access.asset.contentType, input.role);
    }
    const { replaced } = await this.repository.updateAsset(profile.id, assetId, {
      ...(input.role ? { role: toRoleValue(input.role) } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    });
    await this.release(userId, replaced);
    return this.get(userId, workspaceId);
  }

  async removeAsset(userId: string, workspaceId: string, assetId: string) {
    requireWrite((await this.requireMember(workspaceId, userId)).role);
    const profile = await this.requireLinkedAsset(workspaceId, assetId);
    await this.repository.removeAsset(profile.id, assetId);
    await this.release(userId, [assetId]);
  }

  /**
   * The door Site Intelligence writes through. Findings fill empty fields and
   * refresh fields automation set before; anything a person typed is kept
   * unless `overwriteManual` is set. Retries once if a manual save lands mid-merge.
   */
  async applySuggestion(workspaceId: string, suggestion: BrandSuggestion, options: Omit<BrandSuggestionOptions, 'now'>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.repository.getProfile(workspaceId);
      const merged = mergeBrandSuggestion(
        current ? readBrandDna(current.dna) : emptyBrandDna(),
        readBrandProvenance(current?.provenance),
        suggestion,
        { ...options, now: this.now() },
      );
      if (merged.applied.length === 0) return { applied: merged.applied, skipped: merged.skipped, revision: current?.revision ?? 0 };
      const saved = await this.repository.saveProfile(workspaceId, current?.revision ?? 0, {
        dna: merged.dna,
        provenance: merged.provenance,
        schemaVersion: BRAND_DNA_SCHEMA_VERSION,
        updatedBy: null,
      });
      if (saved) return { applied: merged.applied, skipped: merged.skipped, revision: saved.revision };
    }
    throw conflict((await this.repository.getProfile(workspaceId))?.revision ?? 0);
  }

  /** What a generation in this workspace is told about the brand; undefined while the brand is blank. */
  async resolveGenerationBrand(workspaceId: string): Promise<GenerationBrand | undefined> {
    const profile = await this.repository.getProfile(workspaceId);
    if (!profile) return undefined;
    const dna = readBrandDna(profile.dna);
    const assets = await this.repository.listAssets(profile.id);
    if (isBrandDnaEmpty(dna) && assets.length === 0) return undefined;
    return {
      dna,
      assets: assets.map(({ link, asset }) => ({
        assetId: asset.id,
        role: fromRoleValue(link.role),
        label: link.label,
        fileName: asset.fileName,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
      })),
    };
  }

  /**
   * The brand a generation run by this person is given: their own, or, while
   * they have not set one up, the brand the project's workspace saved.
   */
  async resolveUserGenerationBrand(userId: string, projectWorkspaceId: string): Promise<GenerationBrand | undefined> {
    const personal = await this.repository.getPersonalWorkspaceId(userId);
    const own = personal ? await this.resolveGenerationBrand(personal) : undefined;
    if (own || personal === projectWorkspaceId) return own;
    return this.resolveGenerationBrand(projectWorkspaceId);
  }

  private async requireMember(workspaceId: string, userId: string) {
    const access = await this.repository.getWorkspaceAccess(workspaceId, userId);
    if (!access) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
    return access;
  }

  private async requireLinkedAsset(workspaceId: string, assetId: string) {
    const profile = await this.repository.getProfile(workspaceId);
    if (!profile || !(await this.repository.getAsset(profile.id, assetId))) {
      throw new AppError(404, 'BRAND_ASSET_NOT_FOUND', 'This image is not part of the brand.');
    }
    return profile;
  }

  /**
   * Deletes files the brand no longer uses. An image a project also placed is
   * kept for that project; cleanup never fails the request that caused it.
   */
  private async release(userId: string, assetIds: readonly string[]) {
    if (!this.remover) return;
    for (const assetId of assetIds) {
      await this.remover.remove(userId, assetId).catch(() => undefined);
    }
  }

  private toResource(workspaceId: string, profile: BrandProfileRecord | null, assets: BrandAssetRecord[]) {
    return {
      workspaceId,
      revision: profile?.revision ?? 0,
      schemaVersion: BRAND_DNA_SCHEMA_VERSION,
      dna: profile ? readBrandDna(profile.dna) : emptyBrandDna(),
      provenance: readBrandProvenance(profile?.provenance),
      assets: assets.map(({ link, asset }) => ({
        assetId: asset.id,
        role: fromRoleValue(link.role),
        label: link.label,
        source: link.source === 'SITE_INTELLIGENCE' ? 'site_intelligence' as const : 'manual' as const,
        sourceUrl: link.sourceUrl,
        fileName: asset.fileName,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        token: `motify-asset://${asset.id}`,
        createdAt: link.createdAt.toISOString(),
      })),
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    };
  }
}

/** Fonts are linked as fonts, and every other role holds an image. */
function requireKindForRole(contentType: string, role: BrandAssetRole) {
  const kind = assetKind(contentType);
  if (role === 'font' ? kind !== 'font' : kind !== 'image') {
    throw new AppError(422, 'ASSET_KIND_UNSUPPORTED', role === 'font'
      ? 'Upload a .ttf, .otf, .woff or .woff2 file as a font.'
      : 'Only images can be used for this part of Brand DNA.');
  }
}

function conflict(currentRevision: number) {
  return new AppError(409, 'BRAND_REVISION_CONFLICT', 'Brand DNA was changed somewhere else. Reload to see the latest version.', { currentRevision });
}

function requireWrite(role: WorkspaceRole) {
  if (role === 'viewer') throw new AppError(403, 'FORBIDDEN', 'Viewer access is read-only.');
}

function toRoleValue(role: BrandAssetRole): BrandAssetRoleValue {
  return role.toUpperCase() as BrandAssetRoleValue;
}

function fromRoleValue(role: BrandAssetRoleValue): BrandAssetRole {
  return role.toLowerCase() as BrandAssetRole;
}
