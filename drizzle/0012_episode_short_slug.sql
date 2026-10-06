-- Episodes get a short slug, for short links (/s/<shortSlug>): random and
-- unique across the site. Existing episodes get one from the same alphabet as
-- randomShortSlug in src/lib/slug.ts; any that clash are drawn again.
ALTER TABLE "episode" ADD COLUMN "shortSlug" text;--> statement-breakpoint
DO $$
BEGIN
  LOOP
    UPDATE "episode" AS e
    SET "shortSlug" = (
      SELECT string_agg(substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + floor(random() * 31)::int, 1), '')
      -- Refers to the row, so it's drawn for each episode rather than once.
      FROM generate_series(1, 8) WHERE e."id" IS NOT NULL
    )
    WHERE e."shortSlug" IS NULL
      OR e."shortSlug" IN (SELECT "shortSlug" FROM "episode" GROUP BY "shortSlug" HAVING count(*) > 1);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "episode" WHERE "shortSlug" IS NULL
      UNION ALL
      SELECT 1 FROM "episode" GROUP BY "shortSlug" HAVING count(*) > 1
    );
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "episode" ALTER COLUMN "shortSlug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_shortSlug_idx" ON "episode" USING btree ("shortSlug");
