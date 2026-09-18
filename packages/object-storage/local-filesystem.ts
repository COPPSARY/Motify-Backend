import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';

import type { PrivateObjectStorage, StoredObject } from './types.js';

export class LocalFilesystemObjectStorage implements PrivateObjectStorage {
  readonly bucket = 'local';
  private constructor(private readonly root: string) {}

  static async create(root: string) {
    await mkdir(root, { recursive: true });
    return new LocalFilesystemObjectStorage(await realpath(root));
  }

  async createSignedUpload(key: string) {
    return { key, token: '', signedUrl: `local-object://${key}` };
  }

  async inspect(key: string) {
    const metadata = await stat(await this.resolvePath(key));
    return { key, byteSize: metadata.size, contentType: 'application/octet-stream' };
  }

  async openRead(key: string) {
    return createReadStream(await this.resolvePath(key));
  }

  async createSignedReadUrl(key: string) {
    return `local-object://${key}`;
  }

  async putFile(key: string, sourcePath: string, contentType: string): Promise<StoredObject> {
    return this.putStream(key, createReadStream(sourcePath), contentType, Number.MAX_SAFE_INTEGER);
  }

  async putStream(key: string, content: Readable, contentType: string, maxBytes: number): Promise<StoredObject> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid object size limit.');
    const destination = this.resolveKey(key);
    await mkdir(path.dirname(destination), { recursive: true });
    const hash = createHash('sha256');
    let byteSize = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > maxBytes) {
          callback(new Error('Stored object exceeded its size limit.'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(content, meter, createWriteStream(destination, { flags: 'wx' }));
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
    return { key, byteSize, checksum: hash.digest('hex'), contentType };
  }

  async resolvePath(key: string): Promise<string> {
    const resolved = this.resolveKey(key);
    const actual = await realpath(resolved);
    if (!isInside(this.root, actual)) throw new Error('Stored object escaped storage root.');
    return actual;
  }

  async putBuffer(key: string, content: Buffer, contentType: string): Promise<StoredObject> {
    const destination = this.resolveKey(key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { flag: 'wx' });
    return {
      key,
      byteSize: content.byteLength,
      checksum: createHash('sha256').update(content).digest('hex'),
      contentType,
    };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,500}$/.test(key) || key.includes('..') || key.includes('\\')) {
      throw new Error('Invalid object storage key.');
    }
    const resolved = path.resolve(this.root, ...key.split('/'));
    if (!isInside(this.root, resolved)) throw new Error('Object storage key escaped root.');
    return resolved;
  }
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
