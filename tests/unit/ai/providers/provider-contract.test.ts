import { describe, expect, it } from 'vitest';

import { FakeMotionModelProvider } from '../../../../packages/ai/providers/fake.provider.js';

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
});
