ALTER TABLE "episode" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "feedKey" text;--> statement-breakpoint
-- Podcasts already private (which used to mean only unlisted) get a feed key,
-- as their feed is now only served with one.
UPDATE "podcast" SET "feedKey" = replace(gen_random_uuid()::text, '-', '') WHERE "private";
