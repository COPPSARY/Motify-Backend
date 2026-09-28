CREATE TYPE "public"."credit_entry_kind" AS ENUM('SIGNUP_GRANT', 'RESERVE', 'SETTLE', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_balance_check" CHECK ("credit_accounts"."balance" >= 0)
);--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "credit_entry_kind" NOT NULL,
	"amount" integer NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_amount_check" CHECK ("credit_ledger"."amount" <> 0)
);--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_signup_grant_unique" ON "credit_ledger" USING btree ("user_id") WHERE "credit_ledger"."kind" = 'SIGNUP_GRANT';--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_reference_unique" ON "credit_ledger" USING btree ("reference_id","kind") WHERE "credit_ledger"."reference_id" is not null;--> statement-breakpoint
CREATE FUNCTION "public"."credit_ledger_apply"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
	UPDATE "credit_accounts"
	SET "balance" = "balance" + NEW."amount", "updated_at" = now()
	WHERE "user_id" = NEW."user_id";
	IF NOT FOUND THEN
		RAISE EXCEPTION 'credit account missing for user %', NEW."user_id" USING ERRCODE = 'foreign_key_violation';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "credit_ledger_apply" AFTER INSERT ON "credit_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."credit_ledger_apply"();--> statement-breakpoint
CREATE FUNCTION "public"."credit_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
	RAISE EXCEPTION 'credit_ledger rows are append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER "credit_ledger_append_only" BEFORE UPDATE ON "credit_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."credit_ledger_append_only"();--> statement-breakpoint
ALTER TABLE "credit_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "credit_accounts", "credit_ledger" FROM "anon";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "credit_accounts", "credit_ledger" FROM "authenticated";
	END IF;
END
$$;--> statement-breakpoint
INSERT INTO "credit_accounts" ("user_id") SELECT "id" FROM "users" ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "credit_ledger" ("user_id", "kind", "amount", "reference_type", "note") SELECT "id", 'SIGNUP_GRANT', 5000, 'signup', 'Welcome credits' FROM "users" ON CONFLICT DO NOTHING;
