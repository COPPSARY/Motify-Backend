import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const referenceSchema = z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9-]+$/),
    title: z.string().min(1),
    description: z.string().min(1),
});
const manifestSchema = z.strictObject({
    version: z.string().min(1),
    source: z.string().min(1),
    references: z.array(referenceSchema).min(1),
});

export type ReferenceEntry = z.infer<typeof referenceSchema>;

export interface LoadedReference extends ReferenceEntry {
    compositionHtml: string;
    timelineJs: string;
}

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export async function loadReferenceIndex(root = packageRoot): Promise<ReferenceEntry[]> {
    const manifest = manifestSchema.parse(JSON.parse(
        await readFile(path.join(path.resolve(root), 'manifest.json'), 'utf8'),
    ));
    return manifest.references;
}

export async function loadReference(id: string, root = packageRoot): Promise<LoadedReference | undefined> {
    const entry = (await loadReferenceIndex(root)).find((reference) => reference.id === id);
    if (!entry) return undefined;

    const directory = path.resolve(root, entry.id);
    if (path.relative(path.resolve(root), directory).startsWith('..')) return undefined;

    const [compositionHtml, timelineJs] = await Promise.all([
        readFile(path.join(directory, 'composition.html'), 'utf8'),
        readFile(path.join(directory, 'timeline.js'), 'utf8'),
    ]);
    return { ...entry, compositionHtml, timelineJs };
}
