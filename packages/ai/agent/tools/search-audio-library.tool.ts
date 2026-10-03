import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { GenerationAudioTrack } from '../dependencies.js';

const searchAudioLibrarySchema = z.object({
    query: z.string().min(1).max(200).optional(),
});

/**
 * Lets the agent pull in music-library tracks on its own initiative, separate
 * from the tracks the user explicitly attached (those are already resolved
 * into `MotionGraphInput.audio` before the agent runs — see
 * `GenerationService.sendMessage`).
 */
export function createSearchAudioLibraryTool(
    search: (query: string | undefined) => Promise<GenerationAudioTrack[]>,
) {
    return tool(
        async ({ query }) => JSON.stringify(await search(query)),
        {
            name: 'search_audio_library',
            description: 'Searches the workspace and system music library for tracks (title, artist, genre, mood tags, bpm, duration). Call with no query to browse. Use a returned track by placing its motify-audio:// token as an <audio> element\'s src.',
            schema: searchAudioLibrarySchema,
        },
    );
}
