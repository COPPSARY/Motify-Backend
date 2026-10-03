import { describe, expect, it } from 'vitest';
import { loadSkillDoc } from '../../../packages/motify-skills/loader.js';
import { validateMotifyGeneration } from '../../../packages/ai/validation/generation-validator.js';

function extractCodeBlocks(markdown: string): { html: string | undefined; js: string | undefined } {
    const htmlMatch = markdown.match(/```html\s*\n([\s\S]*?)\n```/);
    const jsMatch = markdown.match(/```js(?:cript)?\s*\n([\s\S]*?)\n```/);
    return {
        html: htmlMatch?.[1],
        js: jsMatch?.[1],
    };
}

describe('Motify Skill Code Examples', () => {
    it('validates the canonical HTML and JS scene-kit example', async () => {
        const content = await loadSkillDoc('scene-components/SKILL.md');

        const { html, js } = extractCodeBlocks(content);
        expect(html).toBeDefined();
        expect(js).toBeDefined();

        const result = validateMotifyGeneration({
            title: 'Testing scene-components',
            duration: 5,
            width: 1920,
            height: 1080,
            fps: 60,
            scenes: [
                {
                    id: 'scene-01',
                    label: 'Main Scene',
                    start: 0,
                    duration: 5,
                    accent: '#38bdf8',
                },
            ],
            reply: 'Testing scene-components',
            compositionHtml: html!.replace('<template>', '<template><style></style>'),
            timelineJs: js!,
        });

        expect(
            result.errors,
            `Scene-kit code example failed validation: ${result.errors.map((error) => error.message).join(', ')}`,
        ).toEqual([]);
    });
});
