-- Episodes moved from /<show>/episodes/<episode> to /<show>/<episode>, so an
-- episode can no longer be called "manage" (the show's manage page) or
-- "episodes" (the old addresses, which redirect): give any called that a slug
-- no other episode in the show has.
UPDATE "episode" AS e
SET "slug" = e."slug" || '-' || substr(md5(e."id"), 1, 6)
WHERE e."slug" IN ('manage', 'episodes');--> statement-breakpoint
-- Links in the notifications inbox, so they don't go through the redirect.
UPDATE "notification"
SET "url" = regexp_replace("url", '^/([^/]+)/episodes/', '/\1/')
WHERE "url" ~ '^/[^/]+/episodes/';
