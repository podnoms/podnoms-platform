CREATE TYPE "public"."episode_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "episode" (
	"id" text PRIMARY KEY NOT NULL,
	"podcastId" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
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
CREATE TABLE "playback_position" (
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"positionSeconds" integer NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_position_userId_episodeId_pk" PRIMARY KEY("userId","episodeId")
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
CREATE TABLE "recovery_code" (
	"userId" text NOT NULL,
	"codeHash" text NOT NULL,
	"usedAt" timestamp with time zone,
	CONSTRAINT "recovery_code_userId_codeHash_pk" PRIMARY KEY("userId","codeHash")
);
--> statement-breakpoint
CREATE TABLE "security_key" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"publicKey" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"passwordHash" text,
	"totpSecret" text,
	"totpLastStep" integer,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_podcastId_podcast_id_fk" FOREIGN KEY ("podcastId") REFERENCES "public"."podcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_position" ADD CONSTRAINT "playback_position_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_position" ADD CONSTRAINT "playback_position_episodeId_episode_id_fk" FOREIGN KEY ("episodeId") REFERENCES "public"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast" ADD CONSTRAINT "podcast_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_key" ADD CONSTRAINT "security_key_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_podcastId_publishedAt_idx" ON "episode" USING btree ("podcastId","publishedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_podcastId_slug_idx" ON "episode" USING btree ("podcastId","slug");--> statement-breakpoint
CREATE INDEX "podcast_userId_idx" ON "podcast" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "security_key_userId_idx" ON "security_key" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_idx" ON "user" USING btree (lower("email"));