import { z } from 'zod';

export const FRAMINGS = ['wide', 'medium', 'detail'] as const;

const beatSchema = z.object({
    label: z.string().min(1),
    seconds: z.number().positive(),
    /** What is literally on screen for this beat. */
    onScreen: z.string().min(1),
    /** What visibly changes during it. A beat where nothing happens is a dead beat. */
    action: z.string().min(1),
    framing: z.enum(FRAMINGS),
    /** The single editorial sentence, or empty when the beat carries no copy. */
    copy: z.string(),
}).strict();

/**
 * The structured brief a request is turned into before any source is written.
 *
 * Generation used to reason about structure and author ~40KB of HTML in one
 * call, against a system prompt hundreds of times longer than the request. The
 * request lost: every film came back as the skill's own example beat list. The
 * brief is decided first, in a small context where the request is most of the
 * prompt, and generation then executes it.
 */
export const motionBriefSchema = z.object({
    /** The transformation chain: what the world looks like before, and after. */
    concept: z.string().min(1),
    /** The one object that persists across cuts and carries continuity. */
    carrier: z.string().min(1),
    ground: z.string().min(1),
    accent: z.string().min(1),
    beats: z.array(beatSchema).min(3).max(6),
}).strict();

export type MotionBrief = z.infer<typeof motionBriefSchema>;

/**
 * "Two adjacent beats must differ in framing and in what visibly happens" is a
 * rule the skill states in prose and the model ignored in every sampled film.
 * Here it is checkable, so it is checked.
 */
export function briefDefects(brief: MotionBrief): string[] {
    const defects: string[] = [];
    brief.beats.forEach((beat, index) => {
        const previous = brief.beats[index - 1];
        if (!previous) return;
        if (previous.framing === beat.framing) {
            defects.push(`Beats ${index} and ${index + 1} share framing "${beat.framing}".`);
        }
        if (previous.action.trim().toLowerCase() === beat.action.trim().toLowerCase()) {
            defects.push(`Beats ${index} and ${index + 1} repeat the same action.`);
        }
    });
    return defects;
}
