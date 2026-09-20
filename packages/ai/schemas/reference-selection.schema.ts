import { z } from 'zod';

/**
 * At most one reference. Two films in the prompt produce a blend of both rather
 * than a new film, and the token budget is better spent on one complete example.
 */
export const referenceSelectionSchema = z.object({
    referenceId: z.string(),
}).strict();
