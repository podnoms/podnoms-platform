CREATE TABLE "channel_item" (
	"channelId" text NOT NULL,
	"sourceKey" text NOT NULL,
	"episodeId" text,
	"seenAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_item_channelId_sourceKey_pk" PRIMARY KEY("channelId","sourceKey")
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"podcastId" text NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"lastCheckedAt" timestamp with time zone,
	"nextCheckAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"downloadConcurrency" integer DEFAULT 3 NOT NULL,
	"perPlatformConcurrency" integer DEFAULT 2 NOT NULL,
	"downloadDelaySeconds" integer DEFAULT 10 NOT NULL,
	"channelCheckHours" integer DEFAULT 6 NOT NULL,
	"downloadRateLimit" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "priority" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "channelEpisodeLimit" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_item" ADD CONSTRAINT "channel_item_channelId_channel_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_item" ADD CONSTRAINT "channel_item_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_item_episodeId_idx" ON "channel_item" USING btree ("episodeId");--> statement-breakpoint
CREATE INDEX "channel_podcastId_idx" ON "channel" USING btree ("podcastId");--> statement-breakpoint
CREATE INDEX "channel_nextCheckAt_idx" ON "channel" USING btree ("nextCheckAt");--> statement-breakpoint
-- The one row of site-wide settings, with the defaults above.
INSERT INTO "site_setting" ("id") VALUES ('global') ON CONFLICT DO NOTHING;
