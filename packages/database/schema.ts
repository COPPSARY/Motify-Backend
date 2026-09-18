import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const workspaceRole = pgEnum('workspace_role', ['owner', 'editor', 'viewer']);
export const workspaceKind = pgEnum('workspace_kind', ['personal', 'team']);
export const messageRole = pgEnum('message_role', ['user', 'assistant']);
export const graphIntent = pgEnum('graph_intent', ['CHAT', 'PLAN', 'CREATE', 'EDIT', 'FIX']);
export const generationRunStatus = pgEnum('generation_run_status', ['COMPLETED', 'FAILED']);
export const assetState = pgEnum('asset_state', ['PENDING', 'READY', 'FAILED', 'DELETED']);
export const assetUsageRole = pgEnum('asset_usage_role', ['REFERENCE', 'ASSET']);
export const artifactKind = pgEnum('artifact_kind', [
  'ASSET',
  'SCREENSHOT',
  'CONTACT_SHEET',
  'BUILD_LOG',
  'VALIDATION_REPORT',
  'THUMBNAIL',
  'VIDEO',
]);
export const artifactRetention = pgEnum('artifact_retention', ['TEMPORARY', 'PROJECT']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`)]);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  kind: workspaceKind('kind').default('team').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('workspaces_personal_owner_unique').on(table.ownerId).where(sql`${table.kind} = 'personal'`),
]);

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index('workspace_members_user_idx').on(table.userId),
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  fps: integer('fps').notNull(),
  duration: doublePrecision('duration').notNull(),
  scenes: jsonb('scenes').$type<Record<string, unknown>[]>().default([]).notNull(),
  compositionHtml: text('composition_html').notNull(),
  timelineJs: text('timeline_js').notNull(),
  revision: integer('revision').default(1).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('projects_workspace_slug_unique').on(table.workspaceId, table.slug),
  index('projects_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  check('projects_width_check', sql`${table.width} between 1 and 16384`),
  check('projects_height_check', sql`${table.height} between 1 and 16384`),
  check('projects_fps_check', sql`${table.fps} between 1 and 240`),
  check('projects_duration_check', sql`${table.duration} > 0 and ${table.duration} <= 86400`),
  check('projects_revision_check', sql`${table.revision} >= 1`),
]);

export const authSessions = pgTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  providerExpiresAt: timestamp('provider_expires_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('auth_sessions_user_idx').on(table.userId)]);

export const oauthAttempts = pgTable('oauth_attempts', {
  stateHash: text('state_hash').primaryKey(),
  verifierStateEncrypted: text('verifier_state_encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: messageRole('role').notNull(),
  content: text('content').notNull(),
  intent: graphIntent('intent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('messages_project_created_idx').on(table.projectId, table.createdAt)]);

export const generationRuns = pgTable('generation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  baseRevision: integer('base_revision').notNull(),
  savedRevision: integer('saved_revision'),
  intent: graphIntent('intent').notNull(),
  model: text('model').notNull(),
  selectedSkills: jsonb('selected_skills').$type<string[]>().default([]).notNull(),
  repairAttempts: integer('repair_attempts').default(0).notNull(),
  status: generationRunStatus('status').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('generation_runs_project_created_idx').on(table.projectId, table.createdAt)]);

export const assets = pgTable('assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  state: assetState('state').default('PENDING').notNull(),
  fileName: text('file_name').notNull(),
  label: text('label'),
  tags: text('tags').array().default(sql`ARRAY[]::text[]`).notNull(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  checksum: text('checksum').notNull(),
  width: integer('width'),
  height: integer('height'),
  storageProvider: text('storage_provider').default('supabase').notNull(),
  storageBucket: text('storage_bucket').default('motify-assets').notNull(),
  objectKey: text('object_key').notNull().unique(),
  uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('assets_workspace_created_idx').on(table.workspaceId, table.createdAt),
  check('assets_byte_size_check', sql`${table.byteSize} >= 0`),
]);

export const projectAssets = pgTable('project_assets', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  role: assetUsageRole('role').default('ASSET').notNull(),
  attachedBy: uuid('attached_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.assetId] })]);

export const messageAssets = pgTable('message_assets', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'restrict' }),
  role: assetUsageRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.messageId, table.assetId] })]);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind: artifactKind('kind').notNull(),
  retention: artifactRetention('retention').notNull(),
  contentType: text('content_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  checksum: text('checksum').notNull(),
  objectKey: text('object_key').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('artifacts_expiry_idx').on(table.expiresAt),
  check('artifacts_byte_size_check', sql`${table.byteSize} >= 0`),
]);
