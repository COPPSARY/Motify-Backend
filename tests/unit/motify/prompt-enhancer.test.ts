import { describe, expect, it } from 'vitest';

import {
  enhanceMotifyPrompt,
  MIN_PROMPT_WORDS,
  needsEnhancement,
} from '../../../packages/motify-skills/prompt-enhancer.js';

describe('Motify prompt enhancer', () => {
  it('adds the SaaS film structure without changing the original request', () => {
    const enhanced = enhanceMotifyPrompt('Launch our analytics app with this headline.', 'CREATE');

    expect(enhanced).toContain('Original user request:\nLaunch our analytics app with this headline.');
    expect(enhanced).toContain('3-6 connected beats');
    expect(enhanced).toContain('giant-to-readable zoom or slide entrances');
    expect(enhanced).toContain('shape morph or match-cut');
  });

  it('keeps edits focused on the existing composition', () => {
    const enhanced = enhanceMotifyPrompt('Make the headline yellow.', 'EDIT');

    expect(enhanced).toContain('Original user request:\nMake the headline yellow.');
    expect(enhanced).toContain('preserving the existing visual language');
    expect(enhanced).not.toContain('Build 3-6 connected beats');
  });
});

describe('needsEnhancement', () => {
  it('flags a terse request that lacks direction', () => {
    expect(needsEnhancement('make a video about my app')).toBe(true);
  });

  it('leaves a detailed request untouched', () => {
    expect(needsEnhancement(
      'Create a 12 second launch film that opens on the dashboard, shows the sync friction, then reveals our new automation panel.',
    )).toBe(false);
  });

  it('counts words after collapsing surrounding whitespace', () => {
    const belowThreshold = Array(MIN_PROMPT_WORDS - 1).fill('word').join('  ');
    const atThreshold = Array(MIN_PROMPT_WORDS).fill('word').join(' ');

    expect(needsEnhancement(`  ${belowThreshold}  `)).toBe(true);
    expect(needsEnhancement(atThreshold)).toBe(false);
  });
});
