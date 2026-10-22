-- Mixcloud uploads listed by yt-dlp (an admin's first check of a channel) were
-- keyed by yt-dlp's id ("mixcloud:user_mix"), and by the API's path
-- ("mixcloud:/user/mix/") on later checks, so later checks imported the newest
-- uploads a second time. Re-key the yt-dlp ones by their episode's page, as
-- they're keyed now, and delete the copies, keeping the first episode made of
-- each upload. The copies' files go with the daily media clean-up.
CREATE TEMP TABLE "mixcloud_rekey" AS
SELECT ci."channelId", ci."sourceKey" AS "oldKey", ci."episodeId",
  'mixcloud:' || regexp_replace(
    regexp_replace(e."sourceUrl", '^https?://(www\.)?mixcloud\.com', ''), '/?([?#].*)?$', '/'
  ) AS "newKey"
FROM "channel_item" ci
JOIN "channel" c ON c."id" = ci."channelId"
JOIN "episode" e ON e."id" = ci."episodeId"
WHERE c."platform" = 'mixcloud'
  AND ci."sourceKey" NOT LIKE 'mixcloud:/%'
  AND e."sourceUrl" ~ '^https?://(www\.)?mixcloud\.com/[^/?#]+/[^/?#]+/?([?#].*)?$';--> statement-breakpoint
DELETE FROM "episode" WHERE "id" IN (
  SELECT copy."episodeId"
  FROM "channel_item" copy
  JOIN "mixcloud_rekey" r ON copy."channelId" = r."channelId" AND copy."sourceKey" = r."newKey"
  WHERE copy."episodeId" IS NOT NULL AND copy."episodeId" <> r."episodeId"
);--> statement-breakpoint
DELETE FROM "channel_item" copy
USING "mixcloud_rekey" r
WHERE copy."channelId" = r."channelId" AND copy."sourceKey" = r."newKey";--> statement-breakpoint
UPDATE "channel_item" ci
SET "sourceKey" = r."newKey"
FROM "mixcloud_rekey" r
WHERE ci."channelId" = r."channelId" AND ci."sourceKey" = r."oldKey";--> statement-breakpoint
DROP TABLE "mixcloud_rekey";
