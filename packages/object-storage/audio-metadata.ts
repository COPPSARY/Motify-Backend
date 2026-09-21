import { parseBuffer } from 'music-metadata';

/** Longer files are almost certainly not a soundtrack for a motion film. */
const MAX_DURATION_MS = 20 * 60_000;

export interface AudioMetadata {
    durationMs: number;
    title: string | null;
    artist: string | null;
    genre: string | null;
    bpm: number | null;
}

/**
 * Reads duration and embedded tags without decoding or executing anything. The
 * parser is pure JavaScript, so untrusted bytes never reach a native codec here.
 */
export async function inspectAudio(bytes: Buffer, contentType: string): Promise<AudioMetadata> {
    const metadata = await parseBuffer(bytes, { mimeType: contentType, size: bytes.byteLength }, { duration: true, skipCovers: true });
    const seconds = metadata.format.duration;
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Audio duration could not be read.');
    const durationMs = Math.round(seconds * 1000);
    if (durationMs > MAX_DURATION_MS) throw new Error('Audio assets are limited to 20 minutes.');
    const bpm = metadata.common.bpm;
    return {
        durationMs,
        title: cleanTag(metadata.common.title),
        artist: cleanTag(metadata.common.artist),
        genre: cleanTag(metadata.common.genre?.[0]),
        bpm: bpm !== undefined && bpm >= 20 && bpm <= 300 ? Math.round(bpm) : null,
    };
}

function cleanTag(value: string | undefined): string | null {
    const trimmed = value?.trim().slice(0, 100);
    return trimmed ? trimmed : null;
}
