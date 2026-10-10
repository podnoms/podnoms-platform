CREATE TABLE "password_reset_token" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "smtpHost" text;--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "smtpPort" integer DEFAULT 587 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "smtpSecure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "smtpUser" text;--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "smtpPassword" text;--> statement-breakpoint
ALTER TABLE "site_setting" ADD COLUMN "emailFrom" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notifyEpisodeFailed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "notifyNewEpisodes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_token_userId_idx" ON "password_reset_token" USING btree ("userId");