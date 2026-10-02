-- Descriptions are now HTML. Convert existing plain-text ones: escape them,
-- make blank-line-separated blocks paragraphs and keep single line breaks.
UPDATE "episode"
SET "description" = '<p>' || replace(
  regexp_replace(
    replace(replace(replace(replace(btrim("description", E' \t\r\n'), E'\r', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    E'\n{2,}', '</p><p>', 'g'
  ),
  E'\n', '<br>'
) || '</p>'
WHERE "description" IS NOT NULL AND "description" <> '' AND "description" NOT LIKE '<%';
--> statement-breakpoint
UPDATE "podcast"
SET "description" = '<p>' || replace(
  regexp_replace(
    replace(replace(replace(replace(btrim("description", E' \t\r\n'), E'\r', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    E'\n{2,}', '</p><p>', 'g'
  ),
  E'\n', '<br>'
) || '</p>'
WHERE "description" IS NOT NULL AND "description" <> '' AND "description" NOT LIKE '<%';
