import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const skillsDirectory = 'packages/motify-skills';

/** Every SKILL.md in the skills folder, as a path relative to it. */
async function skillFiles(): Promise<string[]> {
    const entries = await readdir(skillsDirectory, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name === 'SKILL.md')
        .map((entry) => path.relative(skillsDirectory, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'))
        .sort();
}

describe('the Motify skills', () => {
    it('ships the core skills the agent needs', async () => {
        const files = await skillFiles();

        for (const core of ['runtime-contract', 'write-motify']) expect(files).toContain(`${core}/SKILL.md`);
    });

    it('keeps every skill header valid YAML, or deepagents silently drops the skill', async () => {
        for (const file of await skillFiles()) {
            const text = await readFile(`${skillsDirectory}/${file}`, 'utf8');
            const header = text.split('---')[1] ?? '';
            const description = /^description:\s*(.*)$/m.exec(header)?.[1] ?? '';

            expect(description, `${file} has a description`).not.toBe('');
            // A plain YAML scalar cannot hold ": " or " #", unless the whole value is quoted.
            if (!/^["']/.test(description)) expect(description, `${file} description`).not.toMatch(/: | #/);
        }
    });
});
