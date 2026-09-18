import sharp from 'sharp';

import { validateSvgContent } from './asset-validation.js';

const MAX_PIXELS = 40_000_000;

export interface ImageDimensions {
    width: number;
    height: number;
}

export interface VisionImage {
    bytes: Buffer;
    contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

export async function inspectImage(bytes: Buffer, contentType: string): Promise<ImageDimensions> {
    if (contentType === 'image/svg+xml') validateSvgContent(bytes.toString('utf8'));
    const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 1 || height < 1) throw new Error('Image dimensions could not be read.');
    if (width * height > MAX_PIXELS) throw new Error('Images are limited to 40 megapixels.');
    return { width, height };
}

export async function toVisionImage(bytes: Buffer, contentType: string): Promise<VisionImage> {
    await inspectImage(bytes, contentType);
    if (contentType !== 'image/svg+xml') {
        return { bytes, contentType: requireVisionContentType(contentType) };
    }
    return {
        bytes: await sharp(bytes, { limitInputPixels: MAX_PIXELS })
            .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer(),
        contentType: 'image/png',
    };
}

function requireVisionContentType(contentType: string): VisionImage['contentType'] {
    if (contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/webp' || contentType === 'image/gif') {
        return contentType;
    }
    throw new Error(`Unsupported vision image type: ${contentType}`);
}
