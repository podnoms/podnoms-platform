DROP INDEX "user_username_lower_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_idx" ON "user" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "username";