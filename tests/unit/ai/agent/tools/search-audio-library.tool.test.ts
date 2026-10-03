import { describe, expect, it, vi } from 'vitest';

import { createSearchAudioLibraryTool } from '../../../../../packages/ai/agent/tools/search-audio-library.tool.js';

describe('search_audio_library tool', () => {
    it('passes the query through and returns the tracks as JSON', async () => {
        const track = { trackId: 't1', title: 'Bright Future', artist: null, genre: 'ambient', moodTags: ['calm'], bpm: 90, durationMs: 30_000 };
        const search = vi.fn(async () => [track]);
        const tool = createSearchAudioLibraryTool(search);

        const result = await tool.invoke({ query: 'calm ambient' });

        expect(search).toHaveBeenCalledWith('calm ambient');
        expect(JSON.parse(result as string)).toEqual([track]);
    });

    it('searches with no query to browse the whole library', async () => {
        const search = vi.fn(async () => []);
        const tool = createSearchAudioLibraryTool(search);

        await tool.invoke({});

        expect(search).toHaveBeenCalledWith(undefined);
    });
});
