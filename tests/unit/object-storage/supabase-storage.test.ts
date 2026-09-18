import { describe, expect, it, vi } from 'vitest';

import { SupabaseObjectStorage } from '../../../packages/object-storage/supabase-storage.js';

describe('SupabaseObjectStorage', () => {
    it('creates signed uploads and reads private object metadata', async () => {
        const bucket = {
            createSignedUploadUrl: vi.fn().mockResolvedValue({
                data: { path: 'workspaces/ws/assets/a/object', token: 'upload-token', signedUrl: 'https://storage/upload' },
                error: null,
            }),
            info: vi.fn().mockResolvedValue({ data: { size: 3, contentType: 'image/png' }, error: null }),
            download: vi.fn(),
            createSignedUrl: vi.fn(),
            remove: vi.fn(),
        };
        const client = { storage: { from: vi.fn(() => bucket) } };
        const storage = new SupabaseObjectStorage(client, 'motify-assets');

        await expect(storage.createSignedUpload('workspaces/ws/assets/a/object')).resolves.toEqual({
            key: 'workspaces/ws/assets/a/object',
            token: 'upload-token',
            signedUrl: 'https://storage/upload',
        });
        await expect(storage.inspect('workspaces/ws/assets/a/object')).resolves.toEqual({
            key: 'workspaces/ws/assets/a/object',
            byteSize: 3,
            contentType: 'image/png',
        });
    });

    it('opens private objects, signs reads, and deletes exact keys', async () => {
        const bucket = {
            createSignedUploadUrl: vi.fn(),
            info: vi.fn(),
            download: vi.fn().mockResolvedValue({ data: new Blob(['abc'], { type: 'image/png' }), error: null }),
            createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage/read' }, error: null }),
            remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
        const storage = new SupabaseObjectStorage({ storage: { from: () => bucket } }, 'motify-assets');

        const stream = await storage.openRead('workspaces/ws/assets/a/object');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));

        expect(Buffer.concat(chunks).toString()).toBe('abc');
        await expect(storage.createSignedReadUrl('workspaces/ws/assets/a/object', 300)).resolves.toBe('https://storage/read');
        await expect(storage.delete('workspaces/ws/assets/a/object')).resolves.toBeUndefined();
        expect(bucket.createSignedUrl).toHaveBeenCalledWith('workspaces/ws/assets/a/object', 300);
        expect(bucket.remove).toHaveBeenCalledWith(['workspaces/ws/assets/a/object']);
    });
});
