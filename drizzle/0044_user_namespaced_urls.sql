CREATE TABLE "show_slug_alias" (
	"userId" text NOT NULL,
	"slug" text NOT NULL,
	"showId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_slug_alias_userId_slug_pk" PRIMARY KEY("userId","slug")
);
--> statement-breakpoint
CREATE TABLE "user_slug_alias" (
	"slug" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "show" DROP CONSTRAINT "show_slug_unique";--> statement-breakpoint
DROP INDEX "show_userId_idx";--> statement-breakpoint
ALTER TABLE "show" ADD COLUMN "podcastGuid" text;--> statement-breakpoint
-- Shows' feeds move to /<user>/<show>/feed, so their old feed-URL-derived
-- guids would be wrong; there are no listeners yet, so they start afresh.
UPDATE "show" SET "podcastGuid" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "show" ALTER COLUMN "podcastGuid" SET NOT NULL;--> statement-breakpoint
-- Users' slugs now share the top level with the site's own pages: move any
-- that clash out of the way (they can pick another on /settings).
UPDATE "user" SET "slug" = "slug" || '-' || substr(md5("id"), 1, 6)
WHERE "slug" IN ('about', 'api', 'assets', 'brand', 'embed', 'explore', 'feed', 'following', 'fonts', 'images', 'likes', 'listen', 'live', 'login', 'logout', 'playlists', 'podcasts', 'privacy', 'reset-password', 's', 'search', 'security', 'settings', 'shows', 'signup', 'src', 'tags', 'tos', 'u');--> statement-breakpoint
-- Links in the notifications inbox, to the shows' new addresses: /<show>/...
-- is now /<owner>/<show>/..., and /live/<show> is /<owner>/<show>/live. Show
-- slugs were unique across the site until now, so each names one show.
UPDATE "notification" AS n
SET "url" = '/' || u."slug" || '/' || s."slug" || '/live'
FROM "show" AS s JOIN "user" AS u ON u."id" = s."userId"
WHERE n."url" = '/live/' || s."slug";--> statement-breakpoint
UPDATE "notification" AS n
SET "url" = '/' || u."slug" || n."url"
FROM "show" AS s JOIN "user" AS u ON u."id" = s."userId"
WHERE n."url" = '/' || s."slug" OR n."url" LIKE '/' || s."slug" || '/%';--> statement-breakpoint
-- Shows' slugs can't be the paths under their owner now...
UPDATE "show" SET "slug" = "slug" || '-' || substr(md5("id"), 1, 6)
WHERE "slug" IN ('playlists', 'likes', 'following', 'followers', 'shows');--> statement-breakpoint
-- ...nor episodes' the show's feed and live pages, now under it.
UPDATE "episode" SET "slug" = "slug" || '-' || substr(md5("id"), 1, 6)
WHERE "slug" IN ('feed', 'live');--> statement-breakpoint
ALTER TABLE "show_slug_alias" ADD CONSTRAINT "show_slug_alias_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_slug_alias" ADD CONSTRAINT "show_slug_alias_showId_show_id_fk" FOREIGN KEY ("showId") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_slug_alias" ADD CONSTRAINT "user_slug_alias_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "show_slug_alias_showId_idx" ON "show_slug_alias" USING btree ("showId");--> statement-breakpoint
CREATE UNIQUE INDEX "show_userId_slug_idx" ON "show" USING btree ("userId","slug");