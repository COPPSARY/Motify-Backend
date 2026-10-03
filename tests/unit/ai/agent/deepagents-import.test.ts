import { describe, expect, it } from 'vitest';
import { createDeepAgent } from 'deepagents';

describe('deepagents runtime', () => {
    it('is importable and createDeepAgent returns an invokable agent', () => {
        const agent = createDeepAgent({ systemPrompt: 'test' });
        expect(typeof agent.invoke).toBe('function');
    });
});
