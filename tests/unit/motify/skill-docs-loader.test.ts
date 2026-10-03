import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSkillDoc, skillsRoot } from '../../../packages/motify-skills/loader.js';

describe('motify skills loader', () => {
    it('reads a supporting file by its path inside the skills folder', async () => {
        const doc = await loadSkillDoc('scene-components/SKILL.md');

        expect(doc).toContain('```html');
    });

    it('points at the folder that holds the skills', () => {
        expect(path.basename(skillsRoot)).toBe('motify-skills');
    });

    it('refuses a path that leaves the skills folder', async () => {
        await expect(loadSkillDoc('../ai/agent/system-prompt.ts')).rejects.toThrow(/outside/i);
        await expect(loadSkillDoc('write-motify/../../../package.json')).rejects.toThrow(/outside/i);
    });
});
