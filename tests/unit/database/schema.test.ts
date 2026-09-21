import { getTableName } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  artifacts,
  assets,
  assetUsageRole,
  generationRuns,
  messageAssets,
  messages,
  projectAssets,
  projects,
  users,
} from '../../../packages/database/schema.js';

describe('database schema', () => {
  it('registers the asset and audio library migrations with the Drizzle migrator', async () => {
    const journal = JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain('0012_supabase_asset_roles');
    expect(tags.at(-1)).toBe('0013_audio_library');
    await expect(readFile('drizzle/migrations/0013_audio_library.sql', 'utf8')).resolves.toContain('CREATE TABLE "audio_tracks"');
  });

  it('stores application accounts in the users table', () => {
    expect(getTableName(users)).toBe('users');
  });

  it('stores the current generated project as two source fields', () => {
    expect(getTableName(projects)).toBe('projects');
    expect(projects.name.name).toBe('name');
    expect(projects.updatedAt.name).toBe('updated_at');
    expect(projects.compositionHtml.name).toBe('composition_html');
    expect(projects.timelineJs.name).toBe('timeline_js');
  });

  it('stores direct graph messages and runs without queue state', () => {
    expect(getTableName(messages)).toBe('messages');
    expect(getTableName(generationRuns)).toBe('generation_runs');
    expect(getTableName(artifacts)).toBe('artifacts');
  });

  it('stores reusable assets separately from their project and message roles', () => {
    expect(assetUsageRole.enumValues).toEqual(['REFERENCE', 'ASSET']);
    expect(assets.label.name).toBe('label');
    expect(assets.tags.name).toBe('tags');
    expect(assets.width.name).toBe('width');
    expect(assets.height.name).toBe('height');
    expect(assets.storageProvider.name).toBe('storage_provider');
    expect(assets.storageBucket.name).toBe('storage_bucket');
    expect(projectAssets.role.name).toBe('role');
    expect(projectAssets.attachedBy.name).toBe('attached_by');
    expect(projectAssets.updatedAt.name).toBe('updated_at');
    expect(getTableName(messageAssets)).toBe('message_assets');
    expect(messageAssets.role.name).toBe('role');
  });
});
