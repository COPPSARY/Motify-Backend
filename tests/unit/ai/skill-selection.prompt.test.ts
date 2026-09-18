import { describe, expect, it } from 'vitest';

import { SKILL_SELECTION_SYSTEM_PROMPT } from '../../../packages/ai/prompts/skill-selection.prompt.js';

describe('skill-selection prompt', () => {
    it('describes every preset-derived visual direction to the selector', () => {
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('apple-notes-workflow');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('claude-product-journey');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('kiri-voice-workflow');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('motify-launch-film');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('motionly-promo-film');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('recoup-recovery-story');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('relay-handoff-story');
        expect(SKILL_SELECTION_SYSTEM_PROMPT).toContain('tessera-data-story');
    });
});
