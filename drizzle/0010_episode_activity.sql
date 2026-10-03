CREATE TYPE "public"."activity_source" AS ENUM('web', 'listen', 'embed', 'app');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('play', 'download', 'share');--> statement-breakpoint
CREATE TABLE "episode_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"episodeId" text NOT NULL,
	"podcastId" text NOT NULL,
	"type" "activity_type" NOT NULL,
	"source" "activity_source" NOT NULL,
	"detail" text,
	"visitorHash" text NOT NULL,
	"country" text,
	"region" text,
	"city" text,
	"client" text,
	"os" text,
	"device" text,
	"userAgent" text,
	"referrerHost" text,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_salt" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_activity" ADD CONSTRAINT "episode_activity_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_activity" ADD CONSTRAINT "episode_activity_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_activity_podcastId_occurredAt_idx" ON "episode_activity" USING btree ("podcastId","occurredAt");--> statement-breakpoint
CREATE INDEX "episode_activity_episodeId_occurredAt_idx" ON "episode_activity" USING btree ("episodeId","occurredAt");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_activity_once_a_day_idx" ON "episode_activity" USING btree ("episodeId","type","visitorHash");