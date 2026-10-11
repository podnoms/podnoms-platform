CREATE TABLE "episode_like" (
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_like_userId_episodeId_pk" PRIMARY KEY("userId","episodeId")
);
--> statement-breakpoint
CREATE TABLE "podcast_follow" (
	"userId" text NOT NULL,
	"podcastId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_follow_userId_podcastId_pk" PRIMARY KEY("userId","podcastId")
);
--> statement-breakpoint
ALTER TABLE "episode_like" ADD CONSTRAINT "episode_like_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_like" ADD CONSTRAINT "episode_like_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_follow" ADD CONSTRAINT "podcast_follow_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_follow" ADD CONSTRAINT "podcast_follow_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_like_episodeId_idx" ON "episode_like" USING btree ("episodeId");--> statement-breakpoint
CREATE INDEX "podcast_follow_podcastId_idx" ON "podcast_follow" USING btree ("podcastId");