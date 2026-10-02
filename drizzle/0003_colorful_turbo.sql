CREATE TABLE "playback_position" (
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"positionSeconds" integer NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_position_userId_episodeId_pk" PRIMARY KEY("userId","episodeId")
);
--> statement-breakpoint
ALTER TABLE "playback_position" ADD CONSTRAINT "playback_position_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_position" ADD CONSTRAINT "playback_position_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;