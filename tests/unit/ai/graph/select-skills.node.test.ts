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

    it('includes the existing project and recent messages when editing', async () => {
        const structured = vi.fn().mockResolvedValue({ skillIds: ['editorial-brutalist'] });
        const node = createSelectSkillsNode({
            model: 'test-model',
            provider: { structured },
            loadSkills: async () => ({ manifest: { version: 'test' }, skills }),
            onSkillsSelected: vi.fn(),
        } as unknown as ResolvedMotionGraphDependencies);

        await node({
            intent: 'EDIT',
            message: 'Make the title bigger.',
            project: {
                title: 'Launch film',
                scenes: [{ id: 'scene-01', label: 'Hero statement', start: 0, duration: 4, accent: '#ff0000' }],
            },
            recentMessages: [{ role: 'user', content: 'Build a bold editorial poster film.' }],
        } as unknown as MotionGraphState);

        expect(structured).toHaveBeenCalledWith(expect.objectContaining({
            prompt: expect.stringContaining('Launch film'),
        }));
        expect(structured).toHaveBeenCalledWith(expect.objectContaining({
            prompt: expect.stringContaining('Hero statement'),
        }));
        expect(structured).toHaveBeenCalledWith(expect.objectContaining({
            prompt: expect.stringContaining('Build a bold editorial poster film.'),
        }));
    });

    it('propagates the error when skill selection fails, without a silent fallback', async () => {
        const structured = vi.fn().mockRejectedValue(new Error('provider unavailable'));
        const node = createSelectSkillsNode({
            model: 'test-model',
            provider: { structured },
            loadSkills: async () => ({ manifest: { version: 'test' }, skills }),
            onSkillsSelected: vi.fn(),
        } as unknown as ResolvedMotionGraphDependencies);

        await expect(node({ intent: 'CREATE', message: 'Create a dashboard launch.' } as MotionGraphState))
            .rejects.toThrow('provider unavailable');
    });

    it('shows reference images to the selector but not placeable assets', async () => {
        const structured = vi.fn().mockResolvedValue({ skillIds: [] });
        const node = createSelectSkillsNode({
            model: 'test-model',
            provider: { structured },
            loadSkills: async () => ({ manifest: { version: 'test' }, skills }),
            onSkillsSelected: vi.fn(),
        } as unknown as ResolvedMotionGraphDependencies);
        const image = (assetId: string, role: 'reference' | 'asset') => ({
            assetId, fileName: `${role}.png`, mediaType: 'image/png', dataBase64: 'AA==', role,
        });

        await node({
            intent: 'CREATE',
            message: 'Make a launch film.',
            assets: [image('a', 'asset'), image('b', 'reference')],
        } as unknown as MotionGraphState);

        const request = structured.mock.calls[0]?.[0];
        expect(request.images).toEqual([expect.objectContaining({ assetId: 'b', role: 'reference' })]);
        expect(request.prompt).toContain('reference.png');
    });
});
