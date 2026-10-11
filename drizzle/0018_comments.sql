CREATE TABLE "episode_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"episodeId" text NOT NULL,
	"userId" text NOT NULL,
	"body" text NOT NULL,
	"atSeconds" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_comment" ADD CONSTRAINT "episode_comment_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_comment" ADD CONSTRAINT "episode_comment_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_comment_episodeId_atSeconds_idx" ON "episode_comment" USING btree ("episodeId","atSeconds");