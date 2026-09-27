ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "failed_verification_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "locked_until" timestamp with time zone;
--> statement-breakpoint
UPDATE "two_factor" SET "verified" = "users"."two_factor_enabled"
FROM "users" WHERE "two_factor"."user_id" = "users"."id";
