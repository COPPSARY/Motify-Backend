-- The agent's memory now lives in the server process, so the tables it once used are removed.
-- Written to be safe to run twice, and to do nothing in a database that never had them.
--
--   * public.checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations: orphans of an
--     early prototype that created them without a schema option. Not created by any migration.
--   * the schema agent_checkpoints: the same four tables, from a Postgres checkpointer this project
--     briefly used.
--   * public.agent_turns and public.project_run_leases: from an earlier version of this migration
--     number that was never committed, so only a database that ran it has them.
--
-- The chat transcript (public.messages) is not touched. Agent memory is rebuildable: a project
-- without a saved thread restarts from its last chat messages.
DO $$
BEGIN
	IF to_regclass('public.checkpoints') IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'checkpoints' AND column_name = 'checkpoint_ns'
	) THEN
		RAISE EXCEPTION 'public.checkpoints does not look like a LangGraph table; aborting.';
	END IF;
	IF to_regclass('public.checkpoint_blobs') IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'checkpoint_blobs' AND column_name = 'channel'
	) THEN
		RAISE EXCEPTION 'public.checkpoint_blobs does not look like a LangGraph table; aborting.';
	END IF;
	IF to_regclass('public.checkpoint_writes') IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'checkpoint_writes' AND column_name = 'task_id'
	) THEN
		RAISE EXCEPTION 'public.checkpoint_writes does not look like a LangGraph table; aborting.';
	END IF;
END
$$;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."checkpoint_writes", "public"."checkpoint_blobs", "public"."checkpoints", "public"."checkpoint_migrations";--> statement-breakpoint
DROP SCHEMA IF EXISTS "agent_checkpoints" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public"."agent_turns", "public"."project_run_leases";
