import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { inspectImage, toVisionImage } from '../../../packages/object-storage/image-metadata.js';

describe('image metadata', () => {
    it('reads trusted raster dimensions', async () => {
        const png = await sharp({
            create: { width: 12, height: 8, channels: 4, background: '#7c3aed' },
        }).png().toBuffer();

        await expect(inspectImage(png, 'image/png')).resolves.toEqual({ width: 12, height: 8 });
    });

    it('rejects images over forty megapixels before generation', async () => {
        const oversized = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"><rect width="100%" height="100%"/></svg>');

        await expect(inspectImage(oversized, 'image/svg+xml')).rejects.toThrow('40 megapixels');
    });

    it('rasterizes a safe SVG into a PNG vision input', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#7c3aed"/></svg>');

        const vision = await toVisionImage(svg, 'image/svg+xml');

        expect(vision.contentType).toBe('image/png');
        expect(vision.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });
});
