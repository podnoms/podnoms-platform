CREATE TYPE "public"."episode_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "episode" (
	"id" text PRIMARY KEY NOT NULL,
	"podcastId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"imageUrl" text,
	"sourceUrl" text,
	"audioUrl" text,
	"audioMimeType" text,
	"audioSizeBytes" bigint,
	"durationSeconds" integer,
	"status" "episode_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"explicit" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcast" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"imageUrl" text,
	"category" text,
	"language" text DEFAULT 'en' NOT NULL,
	"explicit" boolean DEFAULT false NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"customDomain" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_slug_unique" UNIQUE("slug"),
	CONSTRAINT "podcast_customDomain_unique" UNIQUE("customDomain")
);
--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast" ADD CONSTRAINT "podcast_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_podcastId_publishedAt_idx" ON "episode" USING btree ("podcastId","publishedAt");--> statement-breakpoint
CREATE INDEX "podcast_userId_idx" ON "podcast" USING btree ("userId");