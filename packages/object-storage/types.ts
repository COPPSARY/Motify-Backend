import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  byteSize: number;
  checksum: string;
  contentType: string;
}

export interface SignedUpload {
  key: string;
  token: string;
  signedUrl: string;
}

export interface StoredObjectMetadata {
  key: string;
  byteSize: number;
  contentType: string;
}

export interface PrivateObjectStorage {
  readonly bucket?: string;
  createSignedUpload(key: string): Promise<SignedUpload>;
  inspect(key: string): Promise<StoredObjectMetadata>;
  openRead(key: string): Promise<Readable>;
  createSignedReadUrl(key: string, expiresInSeconds: number): Promise<string>;
  putFile(key: string, sourcePath: string, contentType: string): Promise<StoredObject>;
  putBuffer(key: string, content: Buffer, contentType: string): Promise<StoredObject>;
  putStream(key: string, content: Readable, contentType: string, maxBytes: number): Promise<StoredObject>;
  resolvePath(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
