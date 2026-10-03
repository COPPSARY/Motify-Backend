import { describe, expect, it } from 'vitest';

import { UsageMeter, recordModelUsage, runWithUsageMeter } from '../../../../packages/ai/usage/usage-meter.js';

describe('UsageMeter', () => {
    it('adds up every call and counts calls that reported nothing', () => {
        const meter = new UsageMeter();
        meter.record(100, 20);
        meter.record(50, null);
        meter.record(null, null);
        expect(meter.snapshot()).toEqual({ inputTokens: 150, outputTokens: 20, cachedInputTokens: 0, calls: 3, unreportedCalls: 1 });
    });

    it('collects usage from concurrent requests separately', async () => {
        const first = new UsageMeter();
        const second = new UsageMeter();
        await Promise.all([
            runWithUsageMeter(first, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                recordModelUsage(10, 1);
            }),
            runWithUsageMeter(second, async () => {
                recordModelUsage(1_000, 100);
                await new Promise((resolve) => setTimeout(resolve, 10));
                recordModelUsage(1_000, 100);
            }),
        ]);
        expect(first.snapshot()).toMatchObject({ inputTokens: 10, outputTokens: 1, calls: 1 });
        expect(second.snapshot()).toMatchObject({ inputTokens: 2_000, outputTokens: 200, calls: 2 });
    });

    it('keeps what was spent when the work throws', async () => {
        const meter = new UsageMeter();
        await expect(runWithUsageMeter(meter, async () => {
            recordModelUsage(500, 50);
            throw new Error('provider failed');
        })).rejects.toThrow('provider failed');
        expect(meter.snapshot()).toMatchObject({ inputTokens: 500, outputTokens: 50 });
    });

    it('ignores unusable token counts and does nothing outside a metered request', () => {
        expect(() => recordModelUsage(10, 10)).not.toThrow();
        const meter = new UsageMeter();
        return runWithUsageMeter(meter, async () => {
            recordModelUsage(-5, Number.NaN);
            recordModelUsage('12', undefined);
            expect(meter.snapshot()).toMatchObject({ inputTokens: 0, outputTokens: 0, calls: 2, unreportedCalls: 2 });
        });
    });
});
