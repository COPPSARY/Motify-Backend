CREATE TYPE "public"."audio_track_scope" AS ENUM('WORKSPACE', 'SYSTEM');--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
CREATE TABLE "audio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "audio_track_scope" NOT NULL,
	"workspace_id" uuid,
	"asset_id" uuid,
	"created_by" uuid,
	"title" text NOT NULL,
	"artist" text,
	"genre" text,
	"mood_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"bpm" integer,
	"license" text,
	"duration_ms" integer NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_tracks_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "audio_tracks_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "audio_tracks_scope_check" CHECK (("audio_tracks"."scope" = 'SYSTEM' and "audio_tracks"."workspace_id" is null and "audio_tracks"."asset_id" is null)
    or ("audio_tracks"."scope" = 'WORKSPACE' and "audio_tracks"."workspace_id" is not null and "audio_tracks"."asset_id" is not null and "audio_tracks"."created_by" is not null)),
	CONSTRAINT "audio_tracks_bpm_check" CHECK ("audio_tracks"."bpm" is null or "audio_tracks"."bpm" between 20 and 300),
	CONSTRAINT "audio_tracks_duration_check" CHECK ("audio_tracks"."duration_ms" > 0),
	CONSTRAINT "audio_tracks_byte_size_check" CHECK ("audio_tracks"."byte_size" >= 0)
);--> statement-breakpoint
CREATE TABLE "project_audio_tracks" (
	"project_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"attached_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_audio_tracks_project_id_track_id_pk" PRIMARY KEY("project_id","track_id")
);--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_audio_tracks" ADD CONSTRAINT "project_audio_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_audio_tracks" ADD CONSTRAINT "project_audio_tracks_track_id_audio_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."audio_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_audio_tracks" ADD CONSTRAINT "project_audio_tracks_attached_by_users_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tracks_workspace_created_idx" ON "audio_tracks" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_tracks_system_checksum_unique" ON "audio_tracks" USING btree ("checksum") WHERE "audio_tracks"."scope" = 'SYSTEM';--> statement-breakpoint
CREATE INDEX "project_audio_tracks_track_idx" ON "project_audio_tracks" USING btree ("track_id");
