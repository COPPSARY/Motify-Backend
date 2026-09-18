import { describe, expect, it } from 'vitest';
import { buildRepairUserPrompt } from '../../../packages/ai/prompts/repair.prompt.js';
import type { ModelImageInput } from '../../../packages/ai/providers/model.provider.js';

const candidate = {
    title: 'T', duration: 1, width: 1920, height: 1080, fps: 60, scenes: [],
    compositionHtml: '<div></div>', timelineJs: '', reply: 'ok',
};

const image = (assetId: string, role: ModelImageInput['role']): ModelImageInput => ({
    assetId, fileName: `${role}.png`, mediaType: 'image/png', dataBase64: 'AA==', role,
});

describe('repair prompt', () => {
    it('keeps assets placeable and references read-only', () => {
        const prompt = buildRepairUserPrompt({
            intent: 'CREATE',
            message: 'make a video',
            candidate,
            errors: [{ field: 'compositionHtml', code: 'REQUIRED_ASSET_MISSING', message: 'missing' }],
            assets: [image('11111111-1111-1111-1111-111111111111', 'asset'), image('22222222-2222-2222-2222-222222222222', 'reference')],
        });

        expect(prompt).toContain('motify-asset://11111111-1111-1111-1111-111111111111');
        expect(prompt).not.toContain('motify-asset://22222222-2222-2222-2222-222222222222');
        expect(prompt).toContain('never put them on screen');
    });
});
