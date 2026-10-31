ALTER TABLE "auth"."mobile_token" ADD COLUMN "pushToken" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "appPushLive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "appPushNewEpisodes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."mobile_token" ADD CONSTRAINT "mobile_token_pushToken_unique" UNIQUE("pushToken");