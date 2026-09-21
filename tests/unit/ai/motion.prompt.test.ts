import { describe, expect, it } from 'vitest';

import { buildMotionSystemPrompt, buildMotionUserPrompt, describeImages } from '../../../packages/ai/prompts/motion.prompt.js';

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

    it('requires a short user-facing completion reply without internal direction notes', () => {
        const prompt = buildMotionSystemPrompt(skills);

        expect(prompt).toContain('The `reply` field must contain 2 or 3 short plain sentences');
        expect(prompt).toContain('Do not include direction notes');
        expect(prompt).toContain('validation commentary');
        expect(prompt).toContain('internal process');
    });
});

describe('buildMotionUserPrompt assets', () => {
    it('gives placeable images tokens and gives references no render token', () => {
        const prompt = buildMotionUserPrompt({
            intent: 'CREATE',
            message: 'Create a launch film.',
            recentMessages: [],
            assets: [
                { assetId: '11111111-1111-4111-8111-111111111111', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'abc', role: 'asset' },
                { assetId: '22222222-2222-4222-8222-222222222222', fileName: 'layout.png', mediaType: 'image/png', dataBase64: 'def', role: 'reference' },
            ],
        });

        const place = prompt.slice(prompt.indexOf('IMAGES TO PLACE'), prompt.indexOf('REFERENCE IMAGES'));
        const references = prompt.slice(prompt.indexOf('REFERENCE IMAGES'));
        expect(place).toContain('logo.png');
        expect(place).toContain('motify-asset://11111111-1111-4111-8111-111111111111');
        expect(place).not.toContain('layout.png');
        expect(references).toContain('layout.png');
        expect(references).not.toContain('22222222-2222-4222-8222-222222222222');
        expect(references).toContain('never put them on screen');
    });
});

describe('describeImages with rendered frames', () => {
    const logo = {
        assetId: '11111111-1111-4111-8111-111111111111',
        fileName: 'logo.png',
        mediaType: 'image/png' as const,
        dataBase64: 'aGVsbG8=',
        role: 'asset' as const,
    };
    const storyboard = { ...logo, fileName: 'storyboard.png', role: 'reference' as const };
    const frame = {
        assetId: 'frame-0',
        fileName: 'frame-2.40s',
        mediaType: 'image/jpeg' as const,
        dataBase64: 'ZnJhbWU=',
        role: 'frame' as const,
        capturedAtSeconds: 2.4,
    };

    it('names the moment each frame was taken and says it is the model own output', () => {
        const sections = describeImages([logo, storyboard, frame]).join('\n\n');

        expect(sections).toContain('FRAMES OF THE FILM YOU ARE FIXING');
        expect(sections).toContain('2.40s');
        expect(sections).toMatch(/never embed a frame/i);
    });

    it('keeps a frame out of the sections that tell the model to use or copy an image', () => {
        const [placeable, references] = describeImages([storyboard, frame]);

        // A frame filed as reference material is an instruction to rebuild the
        // broken layout faithfully, which is the opposite of the repair.
        expect(placeable).toContain('No images to place.');
        expect(references).toContain('storyboard.png');
        expect(references).not.toContain('2.40s');
    });

    it('says nothing about frames when none were rendered', () => {
        expect(describeImages([logo]).join('\n')).not.toContain('FRAMES OF THE FILM');
    });
});
