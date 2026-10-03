import { FakeListChatModel } from '@langchain/core/utils/testing';
import { computeSummarizationDefaults } from 'deepagents';
import { describe, expect, it } from 'vitest';

import { withContextBudget } from '../../../../packages/ai/agent/context-budget.js';

describe('withContextBudget', () => {
    it('makes deepagents summarize by a fraction of the configured budget', () => {
        const model = withContextBudget(new FakeListChatModel({ responses: ['x'] }), 60_000);

        expect((model.profile as { maxInputTokens?: number }).maxInputTokens).toBe(60_000);
        expect(computeSummarizationDefaults(model).trigger).toEqual({ type: 'fraction', value: 0.85 });
    });

    it('returns the same model instance', () => {
        const model = new FakeListChatModel({ responses: ['x'] });
        expect(withContextBudget(model, 10_000)).toBe(model);
    });
});
