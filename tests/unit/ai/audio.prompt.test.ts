import { describe, expect, it } from 'vitest';

import { buildMotionUserPrompt, describeAudio } from '../../../packages/ai/prompts/motion.prompt.js';
import { validateMotifyGeneration } from '../../../packages/ai/validation/generation-validator.js';

const trackId = '00000000-0000-4000-8000-0000000000aa';
const token = `motify-audio://${trackId}`;
const track = { trackId, title: 'Bright Future', artist: 'Studio', genre: 'electronic', moodTags: ['upbeat'], bpm: 120, durationMs: 32_000 };

function generation(body: string) {
  return {
    title: 'Launch', duration: 8, width: 1920, height: 1080, fps: 30, scenes: [],
    compositionHtml: `<template><style>.title { color: white; }</style>${body}<main class="title" data-edit="title">Launch</main></template>`,
    timelineJs: 'export function buildTimeline() { return []; }',
    reply: 'Created the launch animation.',
  };
}

describe('audio prompt', () => {
  it('describes the soundtrack by length, tempo, mood and token', () => {
    const section = describeAudio([track]);
    expect(section).toContain('"Bright Future" by Studio');
    expect(section).toContain('32.0s long');
    expect(section).toContain('120 BPM (one beat every 0.500s, one 4/4 bar every 2.000s)');
    expect(section).toContain('mood upbeat');
    expect(section).toContain(`required audio source: ${token}`);
  });

  it('only adds the section when audio is supplied', () => {
    const base = { intent: 'CREATE' as const, message: 'Make a launch film', recentMessages: [] };
    expect(buildMotionUserPrompt(base)).not.toContain('SOUNDTRACK');
    expect(buildMotionUserPrompt({ ...base, audio: [track] })).toContain('SOUNDTRACK');
  });
});

describe('audio token validation', () => {
  const codes = (html: string, required: string[]) => validateMotifyGeneration(generation(html), { requiredAudioTokens: required })
    .errors.map((error) => error.code);

  it('accepts a required track used as an audio source', () => {
    expect(codes(`<audio data-motify-audio src="${token}" data-start="0"></audio>`, [token])).toEqual([]);
  });

  it('requires every supplied track on an audio element', () => {
    expect(codes('', [token])).toContain('REQUIRED_AUDIO_MISSING');
    expect(codes(`<img src="${token}">`, [token])).toContain('REQUIRED_AUDIO_MISSING');
  });

  it('rejects audio tokens that were not supplied', () => {
    expect(codes(`<audio src="${token}"></audio>`, [])).toContain('UNKNOWN_AUDIO_TOKEN');
  });
});
