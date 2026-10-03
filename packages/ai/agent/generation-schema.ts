import { z } from 'zod';

/**
 * Strictly-positive number expressed as an inclusive minimum. `.positive()` emits
 * `exclusiveMinimum`, which Gemini function declarations reject with a 400, and
 * this schema is sent to the model as a tool parameter schema.
 */
const MIN_POSITIVE = 0.001;
const positive = () => z.number().min(MIN_POSITIVE);

const sceneTrackSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(['Text', 'Element', 'SVG', 'Background', 'Camera']),
    start: z.number().nonnegative(),
    end: positive(),
}).strict();

const sceneShape = {
    id: z.string().min(1),
    label: z.string().min(1),
    start: z.number().nonnegative(),
    duration: positive(),
    accent: z.string().min(1),
};

const sceneSchema = z.object({
    ...sceneShape,
    tracks: z.array(sceneTrackSchema).optional(),
}).strict();

export const motifyGenerationSchema = z.object({
    title: z.string().min(1),
    duration: positive(),
    width: positive().int(),
    height: positive().int(),
    fps: positive(),
    scenes: z.array(sceneSchema),
    compositionHtml: z.string().min(1),
    timelineJs: z.string().min(1),
    reply: z.string().min(1),
}).strict();

/**
 * What the agent passes to `validate_generation` / `finalize_generation`. The film's
 * two large files may be left out: they are then read from the agent's workspace
 * (`/composition.html`, `/timeline.js`), so the agent writes them once instead of
 * three times (draft, validate, finalize). `motifyGenerationSchema` stays the strict
 * shape that is validated and stored.
 */
export const motifyGenerationDraftSchema = motifyGenerationSchema.extend({
    compositionHtml: motifyGenerationSchema.shape.compositionHtml.optional(),
    timelineJs: motifyGenerationSchema.shape.timelineJs.optional(),
});

export type MotifyGeneration = z.infer<typeof motifyGenerationSchema>;
export type MotifyGenerationDraft = z.infer<typeof motifyGenerationDraftSchema>;
