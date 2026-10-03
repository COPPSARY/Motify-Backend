import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const skillRoot = path.join(repositoryRoot, 'packages', 'motify-skills');
const manifestPath = path.join(skillRoot, 'manifest.json');
const action = process.argv[2] ?? 'verify';

const normalize = (content) => content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const hash = (content) => createHash('sha256').update(normalize(content), 'utf8').digest('hex');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const seenIds = new Set();
const seenFiles = new Set();

if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    throw new Error('Motify skill manifest contains no skills.');
}
if (action !== 'update' && manifest.hashAlgorithm !== 'sha256') {
    throw new Error('Motify skill manifest must use sha256.');
}

const diskFiles = (await readdir(skillRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name === 'SKILL.md')
    .map((entry) => path.relative(skillRoot, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
    .sort();
const declaredFiles = manifest.skills.map((skill) => skill.file).sort();
if (JSON.stringify(diskFiles) !== JSON.stringify(declaredFiles)) {
    throw new Error('Motify skill files do not match the manifest.');
}

// Every other Markdown file in a skill folder (its supporting references, styles and guides).
const docFiles = (await readdir(skillRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md')
    .map((entry) => path.relative(skillRoot, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
    .sort();

for (const skill of manifest.skills) {
    if (!skill || typeof skill.id !== 'string' || typeof skill.file !== 'string') {
        throw new Error('Invalid Motify skill manifest entry.');
    }
    if (!/^(?:styles\/)?[a-z0-9-]+\/SKILL\.md$/.test(skill.file)) {
        throw new Error(`Invalid Motify skill path: ${skill.file}`);
    }
    if (seenIds.has(skill.id)) throw new Error(`Duplicate Motify skill id: ${skill.id}`);
    if (seenFiles.has(skill.file)) throw new Error(`Duplicate Motify skill file: ${skill.file}`);
    seenIds.add(skill.id);
    seenFiles.add(skill.file);

    const content = await readFile(path.join(skillRoot, skill.file), 'utf8');
    const actualHash = hash(content);
    if (action === 'update') {
        skill.sha256 = actualHash;
    } else if (skill.sha256 !== actualHash) {
        throw new Error(`Motify skill hash mismatch: ${skill.file}`);
    }
}

if (action === 'update') {
    manifest.files = [];
    for (const file of docFiles) {
        manifest.files.push({ file, sha256: hash(await readFile(path.join(skillRoot, file), 'utf8')) });
    }
    manifest.hashAlgorithm = 'sha256';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
} else if (action === 'verify' || action === 'copy') {
    const declared = (manifest.files ?? []).map((entry) => entry.file).sort();
    if (JSON.stringify(docFiles) !== JSON.stringify(declared)) {
        throw new Error('Motify skill supporting files do not match the manifest.');
    }
    for (const entry of manifest.files ?? []) {
        if (hash(await readFile(path.join(skillRoot, entry.file), 'utf8')) !== entry.sha256) {
            throw new Error(`Motify skill file hash mismatch: ${entry.file}`);
        }
    }
}

if (action === 'copy') {
    const destination = path.join(repositoryRoot, 'dist', 'packages', 'motify-skills');
    // Replace, never merge: a skill removed from the source must not survive in an old build.
    // Only data files are cleared; the loaders tsc emitted into the same folder stay.
    await mkdir(destination, { recursive: true });
    await pruneData(destination);
    await cp(manifestPath, path.join(destination, 'manifest.json'));
    const skillDirs = new Set(manifest.skills.map((skill) => path.dirname(skill.file)));
    for (const skillDir of skillDirs) {
        await cp(path.join(skillRoot, skillDir), path.join(destination, skillDir), { recursive: true });
    }
} else if (action !== 'verify' && action !== 'update') {
    throw new Error(`Unknown Motify skill action: ${action}`);
}

const pastTense = action === 'copy' ? 'copied' : action === 'verify' ? 'verified' : 'updated';
process.stdout.write(`Motify skills ${pastTense}: ${manifest.skills.length}\n`);

/** Deletes every file that is not compiled output (.js, .d.ts, .map), then any folder left empty. */
async function pruneData(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await pruneData(full);
            if ((await readdir(full)).length === 0) await rm(full, { recursive: true, force: true });
        } else if (!/\.(js|d\.ts|map)$/.test(entry.name)) {
            await rm(full, { force: true });
        }
    }
}
