CREATE TABLE "ai_assist_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_draft" text NOT NULL,
	"confirmation" text NOT NULL,
	"status" text DEFAULT 'untrusted_draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"configuration_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"recipient" text,
	"title" text NOT NULL,
	"action_url" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"action_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "kind" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "service_account_id" uuid;--> statement-breakpoint
UPDATE "api_keys" SET "user_id" = "created_by" WHERE "kind" = 'personal' AND "created_by" IS NOT NULL;--> statement-breakpoint
UPDATE "api_keys" SET "revoked_at" = now() WHERE "user_id" IS NULL AND "service_account_id" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "signature_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "secret_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_assist_runs" ADD CONSTRAINT "ai_assist_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_assist_runs" ADD CONSTRAINT "ai_assist_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_assist_runs_org_idx" ON "ai_assist_runs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_configurations_org_uq" ON "ai_configurations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "notification_channels_org_idx" ON "notification_channels" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_org_status_idx" ON "notification_deliveries" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "notifications_org_user_idx" ON "notifications" USING btree ("organisation_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_accounts_org_name_uq" ON "service_accounts" USING btree ("organisation_id","name");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
