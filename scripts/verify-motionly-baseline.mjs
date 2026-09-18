import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const backendRoot = path.resolve(import.meta.dirname, '..');
const frontendRoot = path.resolve(process.argv[2] ?? path.join(backendRoot, '..', 'Motify'));
const manifest = JSON.parse(await readFile(path.join(backendRoot, 'evals/cloud-generation/baseline/manifest.json'), 'utf8'));
const commit = await readHeadCommit(frontendRoot);
if (commit !== manifest.frontendCommit) throw new Error(`Frontend commit mismatch: expected ${manifest.frontendCommit}, received ${commit}.`);

const files = {
  'composition.html': 'src/compositions/presets/motionly-promo/composition.html',
  'timeline.js': 'src/compositions/presets/motionly-promo/timeline.js',
  'index.ts': 'src/compositions/presets/motionly-promo/index.ts',
  frontendRuntime: 'src/composition/runtime.ts',
  frontendHelpers: 'src/composition/presets.ts',
  frontendSkill: '.agents/skills/write-motionly/SKILL.md',
};
for (const [key, relativePath] of Object.entries(files)) {
  const actual = createHash('sha256').update(await readFile(path.join(frontendRoot, relativePath))).digest('hex');
  const expected = manifest.sourceHashes[key];
  if (actual !== expected) throw new Error(`Baseline hash mismatch for ${relativePath}: expected ${expected}, received ${actual}.`);
}
process.stdout.write(`${JSON.stringify({ ok: true, frontendRoot, commit, verifiedFiles: Object.keys(files).length })}\n`);

async function readHeadCommit(repositoryRoot) {
  const gitDirectory = path.join(repositoryRoot, '.git');
  const head = (await readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim();
  if (!head.startsWith('ref: ')) return head;
  const reference = head.slice(5).trim();
  try {
    return (await readFile(path.join(gitDirectory, ...reference.split('/')), 'utf8')).trim();
  } catch {
    const packed = await readFile(path.join(gitDirectory, 'packed-refs'), 'utf8');
    const line = packed.split(/\r?\n/).find((candidate) => candidate.endsWith(` ${reference}`));
    if (!line) throw new Error(`Git reference is missing: ${reference}.`);
    return line.split(' ')[0];
  }
}
