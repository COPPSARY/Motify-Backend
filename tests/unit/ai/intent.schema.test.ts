import { describe, expect, it } from 'vitest';

import { intentSchema } from '../../../packages/ai/schemas/intent.schema.js';

describe('intentSchema', () => {
    it.each(['CREATE', 'EDIT', 'FIX'])(
        'accepts the restored %s intent',
        (intent) => {
            expect(intentSchema.parse({ intent })).toEqual({ intent });
        },
    );

    it('rejects the temporary unified generation intent', () => {
        expect(() => intentSchema.parse({ intent: 'GENERATE' })).toThrow();
    });
});
