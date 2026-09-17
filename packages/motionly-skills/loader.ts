import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const skillSchema = z.strictObject({
    id: z.string().min(1),
    file: z.string().regex(/^(?:styles\/)?[a-z0-9-]+\/SKILL\.md$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.strictObject({
    version: z.string().min(1),
    runtimeRange: z.string().min(1),
    source: z.string().min(1),
    sourceVersion: z.string().min(1),
    hashAlgorithm: z.literal('sha256'),
    skills: z.array(skillSchema).min(1),
});

export type SkillManifest = z.infer<typeof manifestSchema>;

export interface LoadedSkill {
    id: string;
    content: string;
}

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export function normalizeSkillContent(content: string): string {
    return content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function computeSkillHash(content: string): string {
    return createHash('sha256').update(normalizeSkillContent(content), 'utf8').digest('hex');
}

export async function loadSkillBundle(version = 'v1', root = packageRoot) {
    if (version !== 'v1') throw new Error('Unsupported Motionly skill bundle version.');

    const skillRoot = path.resolve(root);
    const manifest = manifestSchema.parse(JSON.parse(
        await readFile(path.join(skillRoot, 'manifest.json'), 'utf8'),
    ));
    const ids = new Set<string>();
    const files = new Set<string>();
    const skills: LoadedSkill[] = [];

    const diskFiles = (await readdir(skillRoot, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name === 'SKILL.md')
        .map((entry) => path.relative(skillRoot, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
        .sort();
    const declaredFiles = manifest.skills.map((entry) => entry.file).sort();
    if (JSON.stringify(diskFiles) !== JSON.stringify(declaredFiles)) {
        throw new Error('Motionly skill files do not match the manifest.');
    }

    for (const entry of manifest.skills) {
        if (ids.has(entry.id)) throw new Error(`Duplicate Motionly skill id: ${entry.id}`);
        if (files.has(entry.file)) throw new Error(`Duplicate Motionly skill file: ${entry.file}`);
        ids.add(entry.id);
        files.add(entry.file);

        const skillFile = path.resolve(skillRoot, entry.file);
        const relativePath = path.relative(skillRoot, skillFile);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new Error('Invalid Motionly skill path.');
        }

        const content = normalizeSkillContent(await readFile(skillFile, 'utf8'));
        const actualHash = computeSkillHash(content);
        if (actualHash !== entry.sha256) {
            throw new Error(`Motionly skill hash mismatch: ${entry.file}`);
        }
        skills.push({ id: entry.id, content });
    }

    return { manifest, skills };
}
