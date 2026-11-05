ALTER TABLE "organisation_members" ADD COLUMN IF NOT EXISTS "sessions_revoked_at" timestamp with time zone;
