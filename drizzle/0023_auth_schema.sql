-- The sign-in tables move to their own "auth" schema, apart from the app's.
-- SET SCHEMA keeps their rows, keys, indexes and foreign keys (to "user", which
-- stays in public).
CREATE SCHEMA IF NOT EXISTS "auth";--> statement-breakpoint
ALTER TABLE "account" SET SCHEMA "auth";--> statement-breakpoint
ALTER TABLE "session" SET SCHEMA "auth";--> statement-breakpoint
ALTER TABLE "verification_token" SET SCHEMA "auth";--> statement-breakpoint
ALTER TABLE "security_key" SET SCHEMA "auth";--> statement-breakpoint
ALTER TABLE "recovery_code" SET SCHEMA "auth";--> statement-breakpoint
ALTER TABLE "password_reset_token" SET SCHEMA "auth";
