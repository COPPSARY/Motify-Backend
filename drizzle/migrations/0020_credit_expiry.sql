-- Plan credits expire at the end of the plan period they were granted for; signup
-- credits and bought packs never expire. Each PLAN_GRANT becomes a credit_grants row
-- (a batch with its own expiry). A trigger on credit_ledger keeps batches in step with
-- every movement, so code that spends or refunds credits needs no change:
--   * a spend draws from the batch that expires soonest, then from permanent credits;
--   * a refund or settle surplus goes back to the batches that reference drew from;
--   * EXPIRE rows are written by the expiry sweep, which empties the batch itself.
-- New enum values cannot be used in the transaction that adds them, so nothing here
-- writes an EXPIRE row; the trigger only compares against it when it later runs.
ALTER TYPE "public"."credit_entry_kind" ADD VALUE IF NOT EXISTS 'EXPIRE';--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grants_ledger_id_unique" UNIQUE("ledger_id"),
	CONSTRAINT "credit_grants_amount_check" CHECK ("credit_grants"."amount" > 0),
	CONSTRAINT "credit_grants_remaining_check" CHECK ("credit_grants"."remaining" >= 0 and "credit_grants"."remaining" <= "credit_grants"."amount")
);--> statement-breakpoint
CREATE TABLE "credit_grant_uses" (
	"grant_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "credit_grant_uses_grant_id_reference_id_pk" PRIMARY KEY("grant_id","reference_id"),
	CONSTRAINT "credit_grant_uses_units_check" CHECK ("credit_grant_uses"."units" >= 0)
);--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_ledger_id_credit_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."credit_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_uses" ADD CONSTRAINT "credit_grant_uses_grant_id_credit_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grants_user_open_idx" ON "credit_grants" USING btree ("user_id","expires_at") WHERE "credit_grants"."remaining" > 0;--> statement-breakpoint
CREATE INDEX "credit_grant_uses_reference_idx" ON "credit_grant_uses" USING btree ("reference_id");--> statement-breakpoint
CREATE FUNCTION "public"."credit_ledger_grants"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
	open_grant record;
	use_row record;
	left_units integer;
	moved integer;
BEGIN
	-- Compared as text: a new enum value cannot be used in the transaction that adds it.
	IF NEW."kind"::text = 'EXPIRE' THEN
		RETURN NULL;
	END IF;
	IF NEW."amount" > 0 AND NEW."expires_at" IS NOT NULL THEN
		INSERT INTO "credit_grants" ("user_id", "ledger_id", "amount", "remaining", "expires_at")
		VALUES (NEW."user_id", NEW."id", NEW."amount", NEW."amount", NEW."expires_at");
	ELSIF NEW."amount" < 0 THEN
		left_units := -NEW."amount";
		FOR open_grant IN
			SELECT "id", "remaining" FROM "credit_grants"
			WHERE "user_id" = NEW."user_id" AND "remaining" > 0
			ORDER BY "expires_at", "created_at"
			FOR UPDATE
		LOOP
			moved := LEAST(left_units, open_grant."remaining");
			UPDATE "credit_grants" SET "remaining" = "remaining" - moved WHERE "id" = open_grant."id";
			IF NEW."reference_id" IS NOT NULL THEN
				INSERT INTO "credit_grant_uses" ("grant_id", "reference_id", "units")
				VALUES (open_grant."id", NEW."reference_id", moved)
				ON CONFLICT ("grant_id", "reference_id") DO UPDATE SET "units" = "credit_grant_uses"."units" + EXCLUDED."units";
			END IF;
			left_units := left_units - moved;
			EXIT WHEN left_units = 0;
		END LOOP;
	ELSIF NEW."amount" > 0 AND NEW."reference_id" IS NOT NULL THEN
		left_units := NEW."amount";
		FOR use_row IN
			SELECT u."grant_id", u."units" FROM "credit_grant_uses" u
			JOIN "credit_grants" g ON g."id" = u."grant_id"
			WHERE u."reference_id" = NEW."reference_id" AND g."user_id" = NEW."user_id" AND u."units" > 0
			ORDER BY g."expires_at" DESC
			FOR UPDATE OF u
		LOOP
			moved := LEAST(left_units, use_row."units");
			-- A batch that expired meanwhile is emptied again by the next expiry sweep.
			UPDATE "credit_grants" SET "remaining" = "remaining" + moved WHERE "id" = use_row."grant_id";
			UPDATE "credit_grant_uses" SET "units" = "units" - moved
			WHERE "grant_id" = use_row."grant_id" AND "reference_id" = NEW."reference_id";
			left_units := left_units - moved;
			EXIT WHEN left_units = 0;
		END LOOP;
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "credit_ledger_grants" AFTER INSERT ON "credit_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."credit_ledger_grants"();--> statement-breakpoint
-- Plan credits granted before this migration become batches expiring 30 days after
-- payment. Spends draw from the soonest-expiring batch, so what the account still
-- holds is assigned to the latest-expiring batches first, never more than the balance.
INSERT INTO "credit_grants" ("user_id", "ledger_id", "amount", "remaining", "expires_at")
SELECT "user_id", "id", "amount",
	LEAST("amount", GREATEST(0, "balance" - COALESCE("later_amount", 0))),
	"expires_at"
FROM (
	SELECT l."user_id", l."id", l."amount", a."balance",
		COALESCE(p."paid_at", l."created_at") + interval '30 days' AS "expires_at",
		SUM(l."amount") OVER (
			PARTITION BY l."user_id" ORDER BY COALESCE(p."paid_at", l."created_at") DESC, l."id" DESC
			ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
		) AS "later_amount"
	FROM "credit_ledger" l
	JOIN "credit_accounts" a ON a."user_id" = l."user_id"
	LEFT JOIN "payments" p ON p."id" = l."reference_id"
	WHERE l."kind" = 'PLAN_GRANT' AND l."amount" > 0
) AS "existing"
ON CONFLICT ("ledger_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "credit_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_grant_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "credit_grants", "credit_grant_uses" FROM "anon";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "credit_grants", "credit_grant_uses" FROM "authenticated";
	END IF;
END
$$;
