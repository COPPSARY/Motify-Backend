import pg from 'pg';

import { normalizeDatabaseUrl } from './connection-url.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const expectedTables = new Set([
  'auth_refresh_tokens',
  'auth_sessions',
  'oauth_attempts',
  'profiles',
  'project_files',
  'projects',
  'users',
  'workspace_members',
  'workspaces',
]);

const pool = new pg.Pool({ connectionString: normalizeDatabaseUrl(databaseUrl), max: 1 });
try {
  const { rows } = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  const tables = rows.map((row) => row.table_name);
  const unexpected = tables.filter((table) => !expectedTables.has(table));
  console.log(`Public tables: ${tables.join(', ') || '(none)'}`);
  if (unexpected.length > 0) throw new Error(`Refusing to reset unexpected public tables: ${unexpected.join(', ')}`);
  if (process.env.CONFIRM_DB_RESET !== 'delete-motify-data') {
    throw new Error('Set CONFIRM_DB_RESET=delete-motify-data before running this destructive reset.');
  }

  await pool.query('begin');
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('drop table if exists auth_refresh_tokens, auth_sessions, oauth_attempts, project_files, project_version_files, project_versions, projects, workspace_members, workspaces, users, profiles cascade');
  await pool.query('drop type if exists workspace_kind, workspace_role');
  await pool.query('commit');
  console.log('Motify application tables and migration history were removed.');
} catch (error) {
  await pool.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
