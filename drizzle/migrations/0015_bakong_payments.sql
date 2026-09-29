CREATE TYPE "public"."billing_plan" AS ENUM('starter', 'pro', 'studio');--> statement-breakpoint
CREATE TYPE "public"."payment_currency" AS ENUM('USD', 'KHR');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"plan" "billing_plan" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "payment_currency" NOT NULL,
	"bill_number" text NOT NULL,
	"qr" text NOT NULL,
	"md5" text NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"bakong_hash" text,
	"payer_account_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_bill_number_unique" UNIQUE("bill_number"),
	CONSTRAINT "payments_md5_unique" UNIQUE("md5"),
	CONSTRAINT "payments_bakong_hash_unique" UNIQUE("bakong_hash"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_paid_check" CHECK ("payments"."status" <> 'PAID' or ("payments"."paid_at" is not null and "payments"."bakong_hash" is not null))
);--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan" "billing_plan" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"last_payment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_subscriptions_period_check" CHECK ("workspace_subscriptions"."current_period_end" > "workspace_subscriptions"."current_period_start")
);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_last_payment_id_payments_id_fk" FOREIGN KEY ("last_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_workspace_created_idx" ON "payments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_pending_expiry_idx" ON "payments" USING btree ("expires_at") WHERE "payments"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "payments", "workspace_subscriptions" FROM "anon";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "payments", "workspace_subscriptions" FROM "authenticated";
	END IF;
END
$$;
