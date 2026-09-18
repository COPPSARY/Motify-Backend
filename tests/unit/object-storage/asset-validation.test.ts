import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateAssetMetadata, validateStoredAsset } from '../../../packages/object-storage/asset-validation.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('asset validation', () => {
  it('limits the first asset release to images and SVGs', () => {
    expect(() => validateAssetMetadata('clip.mp4', 'video/mp4', 12)).toThrow('extension');
    expect(() => validateAssetMetadata('voice.mp3', 'audio/mpeg', 12)).toThrow('extension');
    expect(() => validateAssetMetadata('huge.png', 'image/png', 20_000_001)).toThrow('20 MB');
  });

  it('accepts matching image signatures and rejects extension/MIME spoofing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'motify-asset-validation-'));
    directories.push(directory);
    const png = path.join(directory, 'image.png');
    await writeFile(png, Buffer.from('89504e470d0a1a0a00000000', 'hex'));

    expect(() => validateAssetMetadata('image.png', 'image/png', 12)).not.toThrow();
    await expect(validateStoredAsset(png, 'image/png')).resolves.toBeUndefined();
    expect(() => validateAssetMetadata('image.exe', 'image/png', 12)).toThrow('extension');
    await expect(validateStoredAsset(png, 'image/jpeg')).rejects.toThrow('do not match');
  });

  it('rejects active SVG content', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'motify-svg-validation-'));
    directories.push(directory);
    const svg = path.join(directory, 'image.svg');
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
    await expect(validateStoredAsset(svg, 'image/svg+xml')).rejects.toThrow('active or remote content');
  });

  it('rejects indirect SVG network/active-content bypasses but permits local fragments', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'motify-svg-links-'));
    directories.push(directory);
    const svg = path.join(directory, 'image.svg');
    const unsafe = [
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="//tracker.example/pixel" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "//tracker.example/style";</style></svg>',
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(data:image/svg+xml,bad)" /></svg>',
    ];
    for (const content of unsafe) {
      await writeFile(svg, content, 'utf8');
      await expect(validateStoredAsset(svg, 'image/svg+xml')).rejects.toThrow('active or remote content');
    }

    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><defs><mask id="m"/></defs><rect mask="url(#m)"/><use href="#m"/></svg>', 'utf8');
    await expect(validateStoredAsset(svg, 'image/svg+xml')).resolves.toBeUndefined();
  });
});
