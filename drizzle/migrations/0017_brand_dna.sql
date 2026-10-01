CREATE TYPE "public"."brand_asset_role" AS ENUM('LOGO', 'FAVICON', 'LOGO_VARIANT', 'SCREENSHOT', 'IMAGE', 'ICON');--> statement-breakpoint
CREATE TYPE "public"."brand_source" AS ENUM('MANUAL', 'SITE_INTELLIGENCE');--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"dna" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_profiles_revision_check" CHECK ("brand_profiles"."revision" >= 1)
);--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"brand_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" "brand_asset_role" NOT NULL,
	"label" text,
	"source" "brand_source" DEFAULT 'MANUAL' NOT NULL,
	"source_url" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_assets_brand_id_asset_id_pk" PRIMARY KEY("brand_id","asset_id")
);--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_brand_profiles_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_workspace_unique" ON "brand_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "brand_assets_asset_idx" ON "brand_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_assets_singular_role_unique" ON "brand_assets" USING btree ("brand_id","role") WHERE "brand_assets"."role" in ('LOGO', 'FAVICON');--> statement-breakpoint
ALTER TABLE "brand_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "brand_profiles", "brand_assets" FROM "anon";
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "brand_profiles", "brand_assets" FROM "authenticated";
	END IF;
END
$$;
