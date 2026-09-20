/** Copies the reference films into dist so the built API can read them. */
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const referenceRoot = path.join(repositoryRoot, 'packages', 'motify-references');
const manifestPath = path.join(referenceRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!Array.isArray(manifest.references) || manifest.references.length === 0) {
    throw new Error('Motify reference manifest contains no references.');
}

const destination = path.join(repositoryRoot, 'dist', 'packages', 'motify-references');
await mkdir(destination, { recursive: true });
await cp(manifestPath, path.join(destination, 'manifest.json'));
for (const reference of manifest.references) {
    const output = path.join(destination, reference.id);
    await mkdir(output, { recursive: true });
    for (const file of ['composition.html', 'timeline.js']) {
        await cp(path.join(referenceRoot, reference.id, file), path.join(output, file));
    }
}

process.stdout.write(`Motify references copied: ${manifest.references.length}\n`);
