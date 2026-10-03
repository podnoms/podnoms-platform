ALTER TABLE "user" ADD COLUMN "isAdmin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- New sites make their first user an admin. An existing site with a single
-- user makes that user one; with several there's no telling which signed up
-- first, so an admin has to be chosen by hand.
UPDATE "user" SET "isAdmin" = true WHERE (SELECT count(*) FROM "user") = 1;
