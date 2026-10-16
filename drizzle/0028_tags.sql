CREATE TABLE "episode_tag" (
	"episodeId" text NOT NULL,
	"tagId" text NOT NULL,
	CONSTRAINT "episode_tag_episodeId_tagId_pk" PRIMARY KEY("episodeId","tagId")
);
--> statement-breakpoint
CREATE TABLE "podcast_tag" (
	"podcastId" text NOT NULL,
	"tagId" text NOT NULL,
	CONSTRAINT "podcast_tag_podcastId_tagId_pk" PRIMARY KEY("podcastId","tagId")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_tag" ADD CONSTRAINT "episode_tag_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_tag" ADD CONSTRAINT "episode_tag_tagId_tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_tag" ADD CONSTRAINT "podcast_tag_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_tag" ADD CONSTRAINT "podcast_tag_tagId_tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_tag_tagId_idx" ON "episode_tag" USING btree ("tagId");--> statement-breakpoint
CREATE INDEX "podcast_tag_tagId_idx" ON "podcast_tag" USING btree ("tagId");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_lower_idx" ON "tag" USING btree (lower("name"));