import type { LLMResult } from '@langchain/core/outputs';
import { describe, expect, it } from 'vitest';

import { MotifyUsageCallbackHandler } from '../../../../packages/ai/agent/usage-callback.js';
import { runWithUsageMeter, UsageMeter } from '../../../../packages/ai/usage/usage-meter.js';

describe('MotifyUsageCallbackHandler', () => {
    it('records usage_metadata from the first chat generation', async () => {
        const meter = new UsageMeter();
        const handler = new MotifyUsageCallbackHandler();
        const result: LLMResult = {
            generations: [[{
                text: '',
                message: { usage_metadata: { input_tokens: 120, output_tokens: 45, total_tokens: 165 } },
            } as never]],
        };

        await runWithUsageMeter(meter, async () => {
            await handler.handleLLMEnd?.(result, 'run-1');
        });

        expect(meter.snapshot()).toMatchObject({ inputTokens: 120, outputTokens: 45, calls: 1, unreportedCalls: 0 });
    });

    it('records how many input tokens were served from the prompt cache', async () => {
        const meter = new UsageMeter();
        const handler = new MotifyUsageCallbackHandler();
        const result: LLMResult = {
            generations: [[{
                text: '',
                message: { usage_metadata: { input_tokens: 2000, output_tokens: 40, total_tokens: 2040, input_token_details: { cache_read: 1800, cache_creation: 100 } } },
            } as never]],
        };

        await runWithUsageMeter(meter, async () => {
            await handler.handleLLMEnd?.(result, 'run-1');
        });

        expect(meter.snapshot()).toMatchObject({ inputTokens: 2000, cachedInputTokens: 1800 });
    });

    it('counts a call with no usage metadata as unreported, not zero tokens', async () => {
        const meter = new UsageMeter();
        const handler = new MotifyUsageCallbackHandler();
        const result: LLMResult = { generations: [[{ text: '', message: {} } as never]] };

        await runWithUsageMeter(meter, async () => {
            await handler.handleLLMEnd?.(result, 'run-1');
        });

        expect(meter.snapshot()).toMatchObject({ calls: 1, unreportedCalls: 1 });
    });
});
