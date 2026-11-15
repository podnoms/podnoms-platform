CREATE TABLE "played_episode" (
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "played_episode_userId_episodeId_pk" PRIMARY KEY("userId","episodeId")
);
--> statement-breakpoint
ALTER TABLE "played_episode" ADD CONSTRAINT "played_episode_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played_episode" ADD CONSTRAINT "played_episode_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;