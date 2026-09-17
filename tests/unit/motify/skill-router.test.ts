import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSkillBundle } from '../../../packages/motify-skills/loader.js';
import { routeSkills } from '../../../packages/motify-skills/router.js';

describe('Motify skill bundle', () => {
  it('contains every source used by the frontend generation prompt in prompt order', async () => {
    const bundle = await loadSkillBundle();

    expect(bundle.manifest).toMatchObject({ version: '3.0.0', sourceVersion: '3.0.0' });
    expect(bundle.skills.map((skill) => skill.id)).toEqual([
      'runtime-contract',
      'write-motify',
      'scene-design',
      'scene-components',
      'preset-reference',
      'house-style',
      'editorial-brutalist',
      'playful-learning',
      'apple-glass',
      'technical-data',
      'cinematic-brand',
    ]);
  });

  it('keeps visual direction skills in the styles namespace', async () => {
    const bundle = await loadSkillBundle();
    const visualDirections = new Set([
      'editorial-brutalist',
      'playful-learning',
      'apple-glass',
      'technical-data',
      'cinematic-brand',
    ]);

    expect(
      bundle.manifest.skills
        .filter((skill) => visualDirections.has(skill.id))
        .map((skill) => skill.file),
    ).toEqual([
      'styles/editorial-brutalist/SKILL.md',
      'styles/playful-learning/SKILL.md',
      'styles/apple-glass/SKILL.md',
      'styles/technical-data/SKILL.md',
      'styles/cinematic-brand/SKILL.md',
    ]);
  });

  it('routes only mandatory skills and optional skills selected by the model', async () => {
      const selected = routeSkills(await loadSkillBundle(), [
        'scene-components',
        'playful-learning',
      ]);

      expect(selected.map((skill) => skill.id)).toEqual([
        'runtime-contract',
        'write-motify',
        'scene-components',
        'playful-learning',
      ]);
      expect(selected.at(-1)?.content).toContain('Playful learning product film');
      expect(selected.slice(0, 2).every((skill) => skill.reason === 'Required for generation')).toBe(true);
      expect(selected.at(-1)?.reason).toBe('Selected by AI for this request');
  });

  it('ignores unrecognised IDs and limits a model selection to one visual direction', async () => {
      const selected = routeSkills(await loadSkillBundle(), [
        'not-a-skill',
        'technical-data',
        'editorial-brutalist',
      ]);

      expect(selected.map((skill) => skill.id)).toEqual([
        'runtime-contract',
        'write-motify',
        'technical-data',
      ]);
  });

  it('keeps the runtime contract neutral about visual composition', async () => {
      const selected = routeSkills(await loadSkillBundle(), []);
      const runtimeContract = selected.find((skill) => skill.id === 'runtime-contract');

      expect(runtimeContract?.content).not.toContain('bundled scene-design skill');
      expect(runtimeContract?.content).not.toContain('one centred subject');
  });

  it('does not omit mandatory skills from a sparse selection', async () => {
    const selected = routeSkills({
      manifest: { version: 'test' } as never,
      skills: [
        { id: 'runtime-contract', content: 'a'.repeat(30) },
        { id: 'write-motify', content: 'b'.repeat(30) },
        { id: 'technical-data', content: 'Technical direction' },
      ],
    }, ['technical-data']);

    expect(selected.map((skill) => skill.id)).toEqual([
      'runtime-contract',
      'write-motify',
      'technical-data',
    ]);
  });

  it('verifies migrated skill hashes before loading prompt content', async () => {
    const bundle = await loadSkillBundle();

    expect(bundle.manifest.skills.every((skill) => /^[a-f0-9]{64}$/.test(skill.sha256))).toBe(true);
  });

  it('rejects modified migrated skill content', async () => {
    const sourceRoot = path.resolve('packages/motify-skills');
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'motify-skills-'));
    const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'manifest.json'), 'utf8')) as {
      skills: Array<{ file: string }>;
    };

    try {
      await writeFile(path.join(temporaryRoot, 'manifest.json'), await readFile(path.join(sourceRoot, 'manifest.json')));
      for (const skill of manifest.skills) {
        const destination = path.join(temporaryRoot, skill.file);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, await readFile(path.join(sourceRoot, skill.file)));
      }
      await writeFile(path.join(temporaryRoot, manifest.skills[0]!.file), 'modified');

      await expect(loadSkillBundle('v1', temporaryRoot)).rejects.toThrow('Motify skill hash mismatch');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
