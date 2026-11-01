CREATE TYPE "public"."subscription_provider" AS ENUM('stripe', 'patreon');--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" "subscription_provider" NOT NULL,
	"externalId" text NOT NULL,
	"status" text NOT NULL,
	"active" boolean NOT NULL,
	"currentPeriodEnd" timestamp with time zone,
	"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripeCustomerId" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paidGraceUntil" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_provider_external_idx" ON "subscription" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX "subscription_user_idx" ON "subscription" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_stripeCustomerId_unique" UNIQUE("stripeCustomerId");