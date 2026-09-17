import { describe, expect, it } from 'vitest';

import { buildMotionSystemPrompt } from '../../../packages/ai/prompts/motion.prompt.js';

describe('buildMotionSystemPrompt', () => {
    const skills = [
        {
            id: 'runtime-contract',
            version: '3.0.0',
            reason: 'Required for generation',
            content: 'Runtime instructions',
        },
        {
            id: 'preset-reference',
            version: '3.0.0',
            reason: 'Required for generation',
            content: '# The Motify runtime API\n\n- `cameraPush(timeline, target, options?)`',
        },
    ];

    it('assembles the system prompt from routed skills in their supplied order', () => {
        const prompt = buildMotionSystemPrompt(skills);

        expect(prompt).toContain('MOTIFY SKILL BUNDLE VERSION: 3.0.0');
        expect(prompt.indexOf('SKILL: runtime-contract')).toBeLessThan(
            prompt.indexOf('SKILL: preset-reference'),
        );
        expect(prompt).toContain('Runtime instructions');
        expect(prompt).toContain('cameraPush(timeline, target, options?)');
    });

    it('rejects an empty routed skill bundle', () => {
        expect(() => buildMotionSystemPrompt([])).toThrow('Motify system prompt requires routed skills.');
    });

    it('removes YAML frontmatter while preserving skill content', () => {
        const prompt = buildMotionSystemPrompt([{
            ...skills[0]!,
            content: '---\nname: runtime-contract\ndescription: Use when generating Motify compositions.\n---\n\nRuntime instructions',
        }]);

        expect(prompt).not.toContain('description: Use when');
        expect(prompt).toContain('Runtime instructions');
    });
});
