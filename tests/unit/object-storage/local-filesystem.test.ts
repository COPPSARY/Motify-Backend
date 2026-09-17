import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalFilesystemObjectStorage } from '../../../packages/object-storage/local-filesystem.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('LocalFilesystemObjectStorage', () => {
  it('stores checksummed private objects and resolves only safe keys', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-storage-'));
    const source = path.join(root, 'source.txt');
    directories.push(root);
    await writeFile(source, 'motify artifact', 'utf8');
    const storage = await LocalFilesystemObjectStorage.create(path.join(root, 'objects'));

    const stored = await storage.putFile('workspace/project/file.txt', source, 'text/plain');
    expect(stored).toMatchObject({ byteSize: 15, contentType: 'text/plain' });
    await expect(storage.resolvePath(stored.key)).resolves.toContain('file.txt');
    await expect(storage.resolvePath('../secret')).rejects.toThrow('Invalid object storage key');
  });

  it('streams uploads and removes partial objects that exceed the declared limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'motify-storage-stream-'));
    directories.push(root);
    const storage = await LocalFilesystemObjectStorage.create(path.join(root, 'objects'));

    await expect(storage.putStream('workspace/too-large.bin', Readable.from(Buffer.alloc(9)), 'application/octet-stream', 8))
      .rejects.toThrow('Stored object exceeded its size limit');
    await expect(storage.resolvePath('workspace/too-large.bin')).rejects.toThrow();
  });
});
