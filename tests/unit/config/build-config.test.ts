import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('production TypeScript configuration', () => {
    it('excludes Vite-only runtime reference compositions', async () => {
        const configPath = resolve(process.cwd(), 'tsconfig.build.json');
        const config = JSON.parse(await readFile(configPath, 'utf8')) as {
            exclude?: string[];
        };

        expect(config.exclude).toContain('packages/motify-runtime/reference');
    });
});
