import { describe, expect, it } from 'vitest';

import { inspectAudio } from '../../../packages/object-storage/audio-metadata.js';
import { wavBytes } from './wav.js';

describe('inspectAudio', () => {
  it('reads the duration of a WAV file', async () => {
    await expect(inspectAudio(wavBytes(1.5), 'audio/wav')).resolves.toMatchObject({ durationMs: 1500, title: null, bpm: null });
  });

  it('rejects bytes whose duration cannot be read', async () => {
    await expect(inspectAudio(Buffer.from('RIFF0000WAVE'), 'audio/wav')).rejects.toThrow();
  });
});
