import { getTableName } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  artifacts,
  assets,
  assetUsageRole,
  creditAccounts,
  creditLedger,
  billingPlan,
  generationRuns,
  messageAssets,
  messages,
  payments,
  projectAssets,
  projects,
  users,
  workspaceSubscriptions,
} from '../../../packages/database/schema.js';
import { PLAN_IDS } from '../../../src/services/billing-plans.js';

describe('database schema', () => {
  it('registers the asset and audio library migrations with the Drizzle migrator', async () => {
    const journal = JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain('0012_supabase_asset_roles');
    expect(tags).toContain('0013_audio_library');
    expect(tags).toContain('0014_credits');
    expect(tags.at(-1)).toBe('0015_bakong_payments');
    await expect(readFile('drizzle/migrations/0013_audio_library.sql', 'utf8')).resolves.toContain('CREATE TABLE "audio_tracks"');
    await expect(readFile('drizzle/migrations/0015_bakong_payments.sql', 'utf8')).resolves.toContain('CREATE TABLE "payments"');
  });

  it('keeps billing plan values in step with the plan catalog', () => {
    expect(billingPlan.enumValues).toEqual([...PLAN_IDS]);
    expect(getTableName(payments)).toBe('payments');
    expect(payments.md5.name).toBe('md5');
    expect(getTableName(workspaceSubscriptions)).toBe('workspace_subscriptions');
    expect(workspaceSubscriptions.currentPeriodEnd.name).toBe('current_period_end');
  });

  it('keeps payment tables closed to the public Supabase API', async () => {
    const sql = await readFile('drizzle/migrations/0015_bakong_payments.sql', 'utf8');
    expect(sql).toContain('ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "workspace_subscriptions" ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE "payments", "workspace_subscriptions" FROM "anon"/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE "payments", "workspace_subscriptions" FROM "authenticated"/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('registers the credits migration and keeps credits closed to the public API', async () => {
    const journal = JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((entry) => entry.tag)).toContain('0014_credits');

    const sql = await readFile('drizzle/migrations/0014_credits.sql', 'utf8');
    // Supabase exposes public tables to browsers with the publishable key, so both
    // tables must have row level security on (no policies) and no anon/authenticated grants.
    expect(sql).toContain('ALTER TABLE "credit_accounts" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE "credit_accounts", "credit_ledger" FROM "anon"/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE "credit_accounts", "credit_ledger" FROM "authenticated"/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toContain('CHECK ("credit_accounts"."balance" >= 0)');
    expect(sql).toContain('credit_ledger rows are append-only');
  });

  it('stores credits as an account balance plus an append-only ledger', () => {
    expect(getTableName(creditAccounts)).toBe('credit_accounts');
    expect(getTableName(creditLedger)).toBe('credit_ledger');
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
