CREATE TABLE "live_broadcast" (
	"id" text PRIMARY KEY NOT NULL,
	"podcastId" text NOT NULL,
	"title" text NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone,
	"episodeId" text
);
--> statement-breakpoint
CREATE TABLE "live_chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcastId" text NOT NULL,
	"userId" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "liveKeyHash" text;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "liveTitle" text;--> statement-breakpoint
ALTER TABLE "live_broadcast" ADD CONSTRAINT "live_broadcast_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_broadcast" ADD CONSTRAINT "live_broadcast_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_chat_message" ADD CONSTRAINT "live_chat_message_broadcastId_live_broadcast_id_fk" FOREIGN KEY ("broadcastId") REFERENCES "public"."live_broadcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_chat_message" ADD CONSTRAINT "live_chat_message_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_broadcast_podcastId_startedAt_idx" ON "live_broadcast" USING btree ("podcastId","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "live_broadcast_open_idx" ON "live_broadcast" USING btree ("podcastId") WHERE "live_broadcast"."endedAt" is null;--> statement-breakpoint
CREATE INDEX "live_chat_message_broadcastId_createdAt_idx" ON "live_chat_message" USING btree ("broadcastId","createdAt");