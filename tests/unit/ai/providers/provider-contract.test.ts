import { describe, expect, it } from 'vitest';

import { FakeMotionModelProvider } from '../../../../packages/ai/providers/fake.provider.js';
import { ModelProviderError, normalizeProviderError, parseMotifyGeneration, parseStructured } from '../../../../packages/ai/providers/model.provider.js';
import { intentSchema } from '../../../../packages/ai/schemas/intent.schema.js';

const generation = {
    title: 'Launch',
    duration: 8,
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [{ id: 'intro', label: 'Intro', start: 0, duration: 8, accent: '#7c3aed' }],
    compositionHtml: '<main id="intro">Launch</main>',
    timelineJs: "timeline.from('#intro', { opacity: 0 });",
    reply: 'Created the launch animation.',
};

describe('MotionModelProvider contract', () => {
    it('returns a schema-validated Motify generation', async () => {
        const provider = new FakeMotionModelProvider({ generation, chat: 'Ready.' });

        await expect(provider.generate({
            model: 'fake-model',
            systemInstructions: 'Follow Motify rules.',
            prompt: 'Create a launch animation.',
            limits: { maxOutputTokens: 2_000 },
        })).resolves.toEqual({ generation, usage: { inputTokens: null, outputTokens: null } });
    });

    it('rejects invalid generation output before it reaches the application', async () => {
        const provider = new FakeMotionModelProvider({ generation: { ...generation, duration: 0 }, chat: 'Ready.' });

        await expect(provider.generate({
            model: 'fake-model',
            systemInstructions: 'Follow Motify rules.',
            prompt: 'Create a launch animation.',
            limits: { maxOutputTokens: 2_000 },
        })).rejects.toEqual(expect.objectContaining({
            code: 'PROVIDER_OUTPUT_INVALID',
            retryable: false,
        }));
    });

    it('returns plain text for a chat request', async () => {
        const provider = new FakeMotionModelProvider({ generation, chat: 'Tell me what you want to animate.' });

        await expect(provider.chat({
            model: 'fake-model',
            systemInstructions: 'Help the user plan.',
            messages: [{ role: 'user', content: 'Can you help me?' }],
            limits: { maxOutputTokens: 500 },
        })).resolves.toBe('Tell me what you want to animate.');
    });

    it('honors an already-aborted request', async () => {
        const controller = new AbortController();
        controller.abort();
        const provider = new FakeMotionModelProvider({ generation, chat: 'Ready.' });

        await expect(provider.chat({
            model: 'fake-model',
            systemInstructions: 'Help the user plan.',
            messages: [{ role: 'user', content: 'Hello' }],
            limits: { maxOutputTokens: 500 },
            signal: controller.signal,
        })).rejects.toEqual(expect.objectContaining({ code: 'PROVIDER_TIMEOUT' }));
    });

    it('tags a generic output-invalid error with the calling provider instead of leaving it unset', () => {
        // parseMotifyGeneration has no provider context of its own - it's a shared
        // helper called from every provider's generate() - so its message never
        // names one. normalizeProviderError, called from the provider's catch
        // block, is what attaches the real provider for logging.
        let thrown: unknown;
        try {
            parseMotifyGeneration('not json');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ModelProviderError);
        expect((thrown as ModelProviderError).provider).toBeUndefined();

        const normalized = normalizeProviderError('openrouter', thrown);
        expect(normalized.provider).toBe('openrouter');
        expect(normalized.code).toBe('PROVIDER_OUTPUT_INVALID');
    });

    it('records the offending text when the model output is not JSON at all', () => {
        try {
            parseMotifyGeneration('not json at all');
            expect.unreachable();
        } catch (error) {
            expect((error as ModelProviderError).diagnostics?.cause).toContain('not json at all');
        }
    });

    it('shows a window around the failing character instead of only the head of a long response', () => {
        // A literal unescaped newline inside a JSON string - exactly what a
        // large compositionHtml/timelineJs value risks - fails deep into the
        // text; the first 300 characters (the old fallback) would never show it.
        const filler = '"x": "'.padEnd(1000, 'a');
        const broken = `{${filler}\nbroken"}`;
        try {
            parseMotifyGeneration(broken);
            expect.unreachable();
        } catch (error) {
            const cause = (error as ModelProviderError).diagnostics?.cause;
            expect(cause).toContain('position');
            expect(cause).toContain('broken');
        }
    });

    it('records which fields failed schema validation, not the whole value', () => {
        try {
            parseStructured('{"intent":"NOT_A_REAL_INTENT"}', intentSchema);
            expect.unreachable();
        } catch (error) {
            expect((error as ModelProviderError).diagnostics?.cause).toContain('intent');
        }
    });
});
