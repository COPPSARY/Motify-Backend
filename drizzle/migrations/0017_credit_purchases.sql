-- New enum values cannot be used in the transaction that adds them, so this
-- migration does not write PLAN_GRANT rows. Plan credits for payments already
-- PAID are granted by the API's payment sweep, which fills in any missing grant.
ALTER TYPE "public"."credit_entry_kind" ADD VALUE IF NOT EXISTS 'PLAN_GRANT';--> statement-breakpoint
ALTER TYPE "public"."credit_entry_kind" ADD VALUE IF NOT EXISTS 'PACK_PURCHASE';--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('PLAN', 'CREDIT_PACK');--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" "payment_kind" DEFAULT 'PLAN' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "credit_pack" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "credit_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "plan" DROP NOT NULL;--> statement-breakpoint
-- Plan payments made before plan credits existed get the published plan credits.
UPDATE "payments" SET "credit_units" = CASE "plan" WHEN 'starter' THEN 15000 WHEN 'pro' THEN 30000 WHEN 'studio' THEN 75000 ELSE 0 END WHERE "kind" = 'PLAN';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_check" CHECK (("payments"."kind" = 'PLAN' and "payments"."plan" is not null and "payments"."credit_pack" is null)
    or ("payments"."kind" = 'CREDIT_PACK' and "payments"."plan" is null and "payments"."credit_pack" is not null and "payments"."credit_units" > 0));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_credit_units_check" CHECK ("payments"."credit_units" >= 0);
