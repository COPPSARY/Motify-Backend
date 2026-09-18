import { Readable } from 'node:stream';

import type {
    PrivateObjectStorage,
    SignedUpload,
    StoredObject,
    StoredObjectMetadata,
} from './types.js';

interface StorageResult<T> {
    data: T | null;
    error: { message?: string } | null;
}

interface SupabaseBucket {
    createSignedUploadUrl(path: string): Promise<StorageResult<{ path: string; token: string; signedUrl: string }>>;
    info(path: string): Promise<StorageResult<{ size?: number; contentType?: string }>>;
    download(path: string): Promise<StorageResult<Blob>>;
    createSignedUrl(path: string, expiresIn: number): Promise<StorageResult<{ signedUrl: string }>>;
    remove(paths: string[]): Promise<StorageResult<unknown>>;
}

export interface SupabaseStorageClient {
    storage: { from(bucket: string): SupabaseBucket };
}

export class SupabaseObjectStorage implements PrivateObjectStorage {
    private readonly storage: SupabaseBucket;

    constructor(client: SupabaseStorageClient, readonly bucket: string) {
        this.storage = client.storage.from(bucket);
    }

    async createSignedUpload(key: string): Promise<SignedUpload> {
        const data = requireData(await this.storage.createSignedUploadUrl(key), 'create signed upload');
        return { key, token: data.token, signedUrl: data.signedUrl };
    }

    async inspect(key: string): Promise<StoredObjectMetadata> {
        const data = requireData(await this.storage.info(key), 'inspect object');
        return { key, byteSize: data.size ?? 0, contentType: data.contentType ?? 'application/octet-stream' };
    }

    async openRead(key: string): Promise<Readable> {
        const data = requireData(await this.storage.download(key), 'download object');
        return Readable.from(Buffer.from(await data.arrayBuffer()));
    }

    async createSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
        const data = requireData(await this.storage.createSignedUrl(key, expiresInSeconds), 'create signed read URL');
        return data.signedUrl;
    }

    async delete(key: string): Promise<void> {
        requireData(await this.storage.remove([key]), 'delete object');
    }

    async putFile(): Promise<StoredObject> {
        throw new Error('Supabase storage uses signed direct uploads.');
    }

    async putBuffer(): Promise<StoredObject> {
        throw new Error('Supabase storage uses signed direct uploads.');
    }

    async putStream(): Promise<StoredObject> {
        throw new Error('Supabase storage uses signed direct uploads.');
    }

    async resolvePath(): Promise<string> {
        throw new Error('Supabase objects do not have local filesystem paths.');
    }
}

function requireData<T>(result: StorageResult<T>, action: string): T {
    if (result.error || result.data === null) {
        throw new Error(`Unable to ${action}: ${result.error?.message ?? 'Supabase Storage returned no data.'}`);
    }
    return result.data;
}
