ALTER TABLE "tag" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_slug_idx" ON "tag" USING btree ("slug");--> statement-breakpoint
-- Keep existing IDs and associations; generate readable URLs with the same
-- accent folding and numbered collisions used by the application.
DO $$
DECLARE
  current_tag record;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR current_tag IN SELECT "id", "name" FROM "tag" ORDER BY lower("name"), "id" LOOP
    base := coalesce(nullif(trim(both '-' from left(trim(both '-' from
      regexp_replace(lower(regexp_replace(normalize(current_tag."name", NFKD),
        U&'[\0300-\036f]', '', 'g')), '[^a-z0-9]+', '-', 'g')
    ), 60)), ''), 'tag');
    candidate := base;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM "tag" WHERE "slug" = candidate) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE "tag" SET "slug" = candidate WHERE "id" = current_tag."id";
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "slug" SET NOT NULL;
