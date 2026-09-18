CREATE TYPE "public"."asset_usage_role" AS ENUM('REFERENCE', 'ASSET');--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "storage_provider" text DEFAULT 'supabase' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "storage_bucket" text DEFAULT 'motify-assets' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "role" "asset_usage_role" DEFAULT 'ASSET' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "attached_by" uuid;--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "project_assets" SET "attached_by" = "projects"."created_by" FROM "projects" WHERE "project_assets"."project_id" = "projects"."id";--> statement-breakpoint
ALTER TABLE "project_assets" ALTER COLUMN "attached_by" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "message_assets" (
	"message_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" "asset_usage_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_assets_message_id_asset_id_pk" PRIMARY KEY("message_id","asset_id")
);--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_attached_by_users_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_assets" ADD CONSTRAINT "message_assets_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_assets" ADD CONSTRAINT "message_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;
