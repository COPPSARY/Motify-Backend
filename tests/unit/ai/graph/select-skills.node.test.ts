import { describe, expect, it, vi } from 'vitest';

import type { ResolvedMotionGraphDependencies } from '../../../../packages/ai/graph/dependencies.js';
import { createSelectSkillsNode } from '../../../../packages/ai/graph/nodes/select-skills.node.js';
import type { MotionGraphState } from '../../../../packages/ai/graph/state.js';
import type { RoutedSkill } from '../../../../packages/motify-skills/router.js';

describe('createSelectSkillsNode', () => {
    const skills = [
        { id: 'runtime-contract', content: 'Runtime contract' },
        { id: 'write-motify', content: 'Write contract' },
        { id: 'scene-components', content: 'Components' },
        { id: 'editorial-brutalist', content: 'Editorial direction' },
        { id: 'technical-data', content: 'Technical direction' },
    ];

    it('uses the model selection while keeping mandatory generation contracts', async () => {
        const onSkillsSelected = vi.fn();
        const structured = vi.fn().mockResolvedValue({
            skillIds: ['scene-components', 'editorial-brutalist'],
        });
        const node = createSelectSkillsNode({
            model: 'test-model',
            provider: { structured },
            loadSkills: async () => ({
                manifest: { version: 'test' },
                skills,
            }),
            onSkillsSelected,
        } as unknown as ResolvedMotionGraphDependencies);

        const update = await node({
            intent: 'EDIT',
            message: 'Make this a bold editorial poster film.',
        } as MotionGraphState);

        const selectedSkills = update.selectedSkills as RoutedSkill[];
        expect(selectedSkills.map((skill) => skill.id)).toEqual([
            'runtime-contract',
            'write-motify',
            'scene-components',
            'editorial-brutalist',
        ]);
        expect(structured).toHaveBeenCalledWith(expect.objectContaining({
            schemaName: 'motify_skill_selection',
            prompt: expect.stringContaining('bold editorial poster'),
        }));
        expect(onSkillsSelected).toHaveBeenCalledWith(expect.objectContaining({
            totalCharacters: expect.any(Number),
            skills: expect.arrayContaining([
                expect.objectContaining({ id: 'editorial-brutalist' }),
            ]),
        }));
    });

    it('uses a safe fallback when skill selection is unavailable', async () => {
        const structured = vi.fn().mockRejectedValue(new Error('provider unavailable'));
        const node = createSelectSkillsNode({
            model: 'test-model',
            provider: { structured },
            loadSkills: async () => ({ manifest: { version: 'test' }, skills }),
            onSkillsSelected: vi.fn(),
        } as unknown as ResolvedMotionGraphDependencies);

        const update = await node({ intent: 'CREATE', message: 'Create a dashboard launch.' } as MotionGraphState);

        expect((update.selectedSkills as RoutedSkill[]).map((skill) => skill.id)).toEqual([
            'runtime-contract',
            'write-motify',
            'technical-data',
        ]);
    });
});
