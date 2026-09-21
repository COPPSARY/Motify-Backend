// Adds a curated, developer-owned track to the music library as a SYSTEM track,
// readable by every signed-in user. Re-running with the same file is a no-op.
//
//   npm run audio:seed -- ./songs/bright-future.mp3 --license "CC0 (Pixabay)" \
//     --title "Bright Future" --artist "Studio" --genre electronic --mood upbeat,hopeful --bpm 120
//
// Title, artist, genre and BPM default to the file's embedded tags.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { createDatabase } from '../packages/database/client.js';
import { audioTracks } from '../packages/database/schema.js';
import { validateAssetBuffer, validateAssetMetadata } from '../packages/object-storage/asset-validation.js';
import { inspectAudio } from '../packages/object-storage/audio-metadata.js';
import { parseEnvironment } from '../src/config/env.js';
import { DatabaseAudioRepository } from '../src/repositories/audio.repository.js';

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.weba': 'audio/webm', '.webm': 'audio/webm',
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    artist: { type: 'string' },
    genre: { type: 'string' },
    mood: { type: 'string' },
    bpm: { type: 'string' },
    license: { type: 'string' },
  },
});

const filePath = positionals[0];
if (!filePath || !values.license) {
  throw new Error('Usage: npm run audio:seed -- <file> --license "<license>" [--title] [--artist] [--genre] [--mood a,b] [--bpm 120]');
}
const fileName = path.basename(filePath);
const contentType = CONTENT_TYPES[path.extname(fileName).toLowerCase()];
if (!contentType) throw new Error(`Unsupported audio extension: ${fileName}`);

const bytes = await readFile(filePath);
validateAssetMetadata(fileName, contentType, bytes.byteLength);
validateAssetBuffer(bytes, contentType);
const tags = await inspectAudio(bytes, contentType);
const bpm = values.bpm !== undefined ? Number(values.bpm) : tags.bpm;
if (bpm !== null && (!Number.isInteger(bpm) || bpm < 20 || bpm > 300)) throw new Error('--bpm must be an integer between 20 and 300.');
const checksum = createHash('sha256').update(bytes).digest('hex');

const environment = parseEnvironment(process.env);
const { db, pool } = createDatabase(environment.databaseUrl);
try {
  const repository = new DatabaseAudioRepository(db);
  const existing = await repository.getSystemByChecksum(checksum);
  if (existing) {
    console.log(`Already in the library: "${existing.title}" (${existing.id})`);
  } else {
    // The API's storage adapter only issues signed uploads; this trusted developer
    // tool writes with the service-role client directly.
    const bucket = createClient(
      environment.supabaseUrl,
      environment.supabaseServiceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ).storage.from(environment.supabaseStorageBucket);
    const trackId = randomUUID();
    const objectKey = `system/audio/${trackId}/${randomUUID()}`;
    const upload = await bucket.upload(objectKey, bytes, { contentType, upsert: false });
    if (upload.error) throw new Error(`Unable to upload track: ${upload.error.message}`);
    try {
      const track = await repository.create({
        id: trackId,
        scope: 'SYSTEM',
        title: values.title ?? tags.title ?? fileName.replace(/\.[^.]+$/, ''),
        artist: values.artist ?? tags.artist,
        genre: values.genre ?? tags.genre,
        moodTags: values.mood ? values.mood.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        bpm,
        license: values.license,
        durationMs: tags.durationMs,
        contentType,
        byteSize: bytes.byteLength,
        checksum,
        objectKey,
      } satisfies typeof audioTracks.$inferInsert);
      console.log(`Added "${track.title}" (${track.id}), ${(track.durationMs / 1000).toFixed(1)}s`);
    } catch (error) {
      await bucket.remove([objectKey]).catch(() => undefined);
      throw error;
    }
  }
} finally {
  await pool.end();
}
