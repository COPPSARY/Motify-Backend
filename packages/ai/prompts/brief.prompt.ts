import type { MotionBrief } from '../schemas/brief.schema.js';
import type { ModelRequestLimits } from '../providers/model.provider.js';

/**
 * Gemini counts thinking against maxOutputTokens. A 2,000 budget was spending
 * ~1,900 on thought and returning a truncated brief, so this leaves room for
 * both.
 */
export const BRIEF_LIMITS: ModelRequestLimits = { maxOutputTokens: 8_000, thinking: 'auto' };

/**
 * Deliberately short. The brief exists so structure is decided where the user's
 * request is the bulk of the prompt rather than a rounding error in it, so this
 * prompt must not grow into a second copy of the generation skills.
 */
export const BRIEF_SYSTEM_PROMPT = [
    'You are a motion director. Turn the request into a shot brief for one short film. You are not writing code.',
    '',
    'Derive every beat from this request. Do not reach for a standard structure: a hook/problem/solution/brand progression is one option among many and is wrong for most requests. A typography piece has no product beats. A data piece has no lifestyle beats.',
    'Name the transformation the film shows: what the world looks like before, and after.',
    'Name one carrier - a single object that persists across cuts so the film reads as continuous rather than as slides.',
    'Give each beat a different framing from the beat before it, and a different visible action. Two beats that both say "text appears centred" are one beat.',
    'Say what is literally on screen. "A dashboard" is not an answer; "one invoice row, its status field flipping from pending to settled" is.',
    'Copy is one full sentence per beat at most, and many beats carry none.',
    'Choose a ground and an accent colour as hex values that suit the subject.',
    'Three to six beats. Total running time should match any duration the user asked for.',
].join('\n');

export function buildBriefPrompt(message: string): string {
    return `Write the shot brief for this request:\n${message}`;
}

/** Rendered into the generation prompt as the structure to execute. */
export function describeBrief(brief: MotionBrief): string {
    return [
        'Shot brief for this film. Execute it; do not substitute a different structure.',
        `concept: ${brief.concept}`,
        `carrier: ${brief.carrier}`,
        `ground: ${brief.ground}`,
        `accent: ${brief.accent}`,
        '',
        ...brief.beats.map((beat, index) => [
            `beat ${index + 1} - ${beat.label} (${beat.seconds}s, ${beat.framing})`,
            `  on screen: ${beat.onScreen}`,
            `  action: ${beat.action}`,
            ...(beat.copy.trim() ? [`  copy: ${beat.copy}`] : []),
        ].join('\n')),
    ].join('\n');
}
