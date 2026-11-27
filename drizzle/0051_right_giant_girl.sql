CREATE TABLE "listening_history" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"type" "activity_type" NOT NULL,
	"source" "activity_source" NOT NULL,
	"detail" text,
	"day" date NOT NULL,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "keepListeningHistory" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listening_history_userId_occurredAt_idx" ON "listening_history" USING btree ("userId","occurredAt");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_history_once_a_day_idx" ON "listening_history" USING btree ("userId","episodeId","type","day");