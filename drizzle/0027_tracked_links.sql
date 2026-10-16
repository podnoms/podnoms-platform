CREATE TABLE "tracked_link" (
	"id" text PRIMARY KEY NOT NULL,
	"episodeId" text NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"openCount" integer DEFAULT 0 NOT NULL,
	"firstOpenedAt" timestamp with time zone,
	"lastOpenedAt" timestamp with time zone,
	"playCount" integer DEFAULT 0 NOT NULL,
	"lastPlayedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_link" ADD CONSTRAINT "tracked_link_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_link_token_idx" ON "tracked_link" USING btree ("token");--> statement-breakpoint
CREATE INDEX "tracked_link_episodeId_idx" ON "tracked_link" USING btree ("episodeId");