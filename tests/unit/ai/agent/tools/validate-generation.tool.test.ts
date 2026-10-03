import { AIMessage } from '@langchain/core/messages';
import { createDeepAgent, StateBackend } from 'deepagents';
import { describe, expect, it } from 'vitest';

import { createValidateGenerationTool } from '../../../../../packages/ai/agent/tools/validate-generation.tool.js';
import { ScriptedModel } from '../memory-harness.js';

const validGeneration = {
    title: 'Demo', duration: 4, width: 1920, height: 1080, fps: 30,
    scenes: [{ id: 's1', label: 'Intro', start: 0, duration: 4, accent: '#ff0000' }],
    compositionHtml: '<template><style>.a{color:red}</style><div class="a" data-edit="e1"></div></template>',
    timelineJs: 'export function buildTimeline() { return {}; }',
    reply: 'Made it.',
};

describe('validate_generation tool', () => {
    it('reports no errors for a valid generation', async () => {
        const tool = createValidateGenerationTool();
        const result = await tool.invoke(validGeneration);
        expect(JSON.parse(result as string)).toMatchObject({ valid: true, errors: [] });
    });

    it('reports a required-asset error when a required asset token is missing', async () => {
        const tool = createValidateGenerationTool({ requiredAssetTokens: ['motify-asset://11111111-1111-4111-8111-111111111111'] });
        const result = await tool.invoke(validGeneration);
        const report = JSON.parse(result as string);
        expect(report.valid).toBe(false);
        expect(report.errors).toContainEqual(expect.objectContaining({ code: 'REQUIRED_ASSET_MISSING' }));
    });

    it('rejects timelineJs that uses a forbidden browser API', async () => {
        const tool = createValidateGenerationTool();
        const result = await tool.invoke({ ...validGeneration, timelineJs: 'export function buildTimeline() { fetch("/x"); }' });
        const report = JSON.parse(result as string);
        expect(report.errors).toContainEqual(expect.objectContaining({ code: 'FORBIDDEN_API' }));
    });

    describe('reading the drafted files from the agent workspace', () => {
        const { compositionHtml, timelineJs, ...metadata } = validGeneration;
        const write = (path: string, content: string, id: string) =>
            new AIMessage({ content: '', tool_calls: [{ id, name: 'write_file', args: { file_path: path, content } }] });
        const validate = new AIMessage({ content: '', tool_calls: [{ id: 'v1', name: 'validate_generation', args: metadata }] });

        async function reportFor(steps: AIMessage[]) {
            const agent = createDeepAgent({
                model: new ScriptedModel([...steps, new AIMessage('done')]) as never,
                tools: [createValidateGenerationTool()],
                backend: new StateBackend(),
            });
            const result: any = await agent.invoke({ messages: [{ role: 'user', content: 'go' }] });
            const toolMessage = result.messages.filter((m: any) => m.name === 'validate_generation').at(-1);
            return JSON.parse(String(toolMessage.content));
        }

        it('validates the drafted files when the call passes only the metadata', async () => {
            const report = await reportFor([
                write('/composition.html', compositionHtml, 'w1'),
                write('/timeline.js', timelineJs, 'w2'),
                validate,
            ]);

            expect(report).toMatchObject({ valid: true, errors: [] });
        });

        it('judges the drafted file, not a stale copy: a forbidden API in the file is reported', async () => {
            const report = await reportFor([
                write('/composition.html', compositionHtml, 'w1'),
                write('/timeline.js', 'export function buildTimeline() { fetch("/x"); }', 'w2'),
                validate,
            ]);

            expect(report.errors).toContainEqual(expect.objectContaining({ code: 'FORBIDDEN_API' }));
        });

        it('tells the agent which file to write when a draft file is missing', async () => {
            const report = await reportFor([write('/timeline.js', timelineJs, 'w2'), validate]);

            expect(report.valid).toBe(false);
            expect(report.errors).toContainEqual(expect.objectContaining({ code: 'DRAFT_MISSING', field: 'compositionHtml' }));
            expect(JSON.stringify(report)).toContain('/composition.html');
        });
    });
});
