-- Episodes get URL slugs, unique within their podcast. Existing episodes get
-- one from their title (as slugify in src/lib/slug.ts does, minus accent
-- folding), numbered "-2", "-3"… where titles repeat within a podcast.
ALTER TABLE "episode" ADD COLUMN "slug" text;--> statement-breakpoint
WITH base AS (
  SELECT
    "id",
    "podcastId",
    "createdAt",
    coalesce(
      nullif(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 60)), ''),
      'episode'
    ) AS "slug"
  FROM "episode"
),
numbered AS (
  SELECT "id", "slug", row_number() OVER (PARTITION BY "podcastId", "slug" ORDER BY "createdAt") AS "n"
  FROM base
)
UPDATE "episode"
SET "slug" = CASE WHEN numbered."n" = 1 THEN numbered."slug" ELSE numbered."slug" || '-' || numbered."n" END
FROM numbered
WHERE numbered."id" = "episode"."id";--> statement-breakpoint
ALTER TABLE "episode" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_podcastId_slug_idx" ON "episode" USING btree ("podcastId","slug");
