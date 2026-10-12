-- site_setting becomes site_settings, and the day's visitor salt moves into it
-- as the app's own "__visitorSalt" setting, replacing the visitor_salt table.
-- The latest salt is kept, so visitors counted today aren't counted again.
ALTER TABLE "site_setting" RENAME TO "site_settings";--> statement-breakpoint
ALTER TABLE "site_settings" RENAME CONSTRAINT "site_setting_pkey" TO "site_settings_pkey";--> statement-breakpoint
INSERT INTO "site_settings" ("key", "value")
SELECT '__visitorSalt', jsonb_build_object('day', to_char("day", 'YYYY-MM-DD'), 'salt', "salt")
FROM "visitor_salt"
ORDER BY "day" DESC
LIMIT 1;--> statement-breakpoint
DROP TABLE "visitor_salt";
