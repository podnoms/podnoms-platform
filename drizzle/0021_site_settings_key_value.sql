-- Site settings become one row per setting (key, JSON value) instead of a
-- column each, so a new setting needs no migration. The values saved in the
-- old row are copied over; those left null fall back to their defaults.
ALTER TABLE "site_setting" RENAME TO "site_setting_old";--> statement-breakpoint
-- Frees the name, so the new table's key is site_setting_pkey as usual.
ALTER TABLE "site_setting_old" RENAME CONSTRAINT "site_setting_pkey" TO "site_setting_old_pkey";--> statement-breakpoint
CREATE TABLE "site_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "site_setting" ("key", "value", "updatedAt")
SELECT setting.key, setting.value, old."updatedAt"
FROM "site_setting_old" old, jsonb_each(to_jsonb(old) - 'id' - 'updatedAt') AS setting(key, value)
WHERE old."id" = 'global' AND setting.value <> 'null'::jsonb;--> statement-breakpoint
DROP TABLE "site_setting_old";
