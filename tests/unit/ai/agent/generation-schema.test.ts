import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { motifyGenerationSchema } from '../../../../packages/ai/agent/generation-schema.js';

const UNSUPPORTED_BY_GEMINI = ['exclusiveMinimum', 'exclusiveMaximum'];

function collectKeys(node: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(node)) node.forEach((item) => collectKeys(item, found));
    else if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
            found.add(key);
            collectKeys(value, found);
        }
    }
    return found;
}

describe('motifyGenerationSchema as a tool parameter schema', () => {
    it('emits no JSON Schema keywords that Gemini function declarations reject', () => {
        const keys = collectKeys(z.toJSONSchema(motifyGenerationSchema, { target: 'draft-7' }));
        for (const keyword of UNSUPPORTED_BY_GEMINI) expect(keys.has(keyword)).toBe(false);
    });

    it('still rejects non-positive durations', () => {
        const result = motifyGenerationSchema.safeParse({ duration: 0 });
        expect(result.success).toBe(false);
    });
});
