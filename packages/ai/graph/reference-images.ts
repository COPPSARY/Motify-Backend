import { readFile } from 'node:fs/promises';

import type { PromptImage } from '../providers/model.provider.js';

/** The subset of AssetService the graph needs to turn ids into image bytes. */
export interface ReferenceAssetReader {
    download(userId: string, assetId: string): Promise<{ path: string; contentType: string; fileName: string }>;
}

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Four images at a few hundred KB each is already a large request. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Resolves attached asset ids to inline image parts.
 *
 * `download` performs the caller's own access check, so an id belonging to
 * another workspace resolves to nothing rather than leaking. A single unreadable
 * or oversized asset is skipped instead of failing the generation.
 */
export function createReferenceImageLoader(assets: ReferenceAssetReader) {
    return async (userId: string, assetIds: string[]): Promise<PromptImage[]> => {
        const images: PromptImage[] = [];
        for (const assetId of assetIds) {
            try {
                const asset = await assets.download(userId, assetId);
                if (!SUPPORTED.has(asset.contentType)) continue;
                const bytes = await readFile(asset.path);
                if (bytes.byteLength > MAX_BYTES) continue;
                images.push({ mimeType: asset.contentType, dataBase64: bytes.toString('base64') });
            } catch {
                continue;
            }
        }
        return images;
    };
}
