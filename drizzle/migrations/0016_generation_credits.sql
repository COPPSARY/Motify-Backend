-- Written to be safe to run twice: some databases already applied this as
-- 0015_generation_credits before it was renumbered after 0015_bakong_payments.
ALTER TABLE "credit_ledger" DROP CONSTRAINT IF EXISTS "credit_ledger_amount_check";--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_amount_check" CHECK ("credit_ledger"."amount" <> 0 or "credit_ledger"."kind" = 'SETTLE');--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "model" text;
