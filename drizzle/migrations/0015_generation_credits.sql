ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_amount_check";--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_amount_check" CHECK ("credit_ledger"."amount" <> 0 or "credit_ledger"."kind" = 'SETTLE');--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "model" text;
