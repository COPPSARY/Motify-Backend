import { describe, expect, it } from 'vitest';

import { buildMotifySystemPrompt } from '../../../../packages/ai/agent/system-prompt.js';

describe('buildMotifySystemPrompt', () => {
    it('does not hard-code which skills to load', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).not.toMatch(/runtime-contract/i);
        expect(prompt).not.toMatch(/write-motify/i);
    });

    it('names the virtual-file workflow and the finishing tools', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).toMatch(/composition\.html/);
        expect(prompt).toMatch(/timeline\.js/);
        expect(prompt).toMatch(/validate_generation/);
        expect(prompt).toMatch(/finalize_generation/);
    });

    it('tells the agent not to repeat the film in the validate and finalize calls', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).not.toMatch(/same content/i);
        expect(prompt).not.toMatch(/assemble its current content/i);
        expect(prompt).toMatch(/do not (repeat|paste|pass)[^.]*(composition|content)/i);
    });

    it('limits how much of the skills the agent reads, without naming any skill', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).toMatch(/at most one style/i);
        expect(prompt).toMatch(/read each skill file once/i);
        expect(prompt).not.toMatch(/runtime-contract|write-motify|gsap-core|scene-components/i);
    });

    it('points to the references folder and says to read it only on direction', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).toContain('/skills/');
        expect(prompt).toMatch(/only when a skill says/i);
    });

    it('keeps routine generation on a direct, bounded workflow', () => {
        const prompt = buildMotifySystemPrompt();
        expect(prompt).toMatch(/routine generation[^.]*short path/i);
        expect(prompt).toMatch(/do not explore unrelated files/i);
        expect(prompt).toMatch(/plan or todo list/i);
        expect(prompt).toMatch(/finalize_generation once/i);
    });
});
