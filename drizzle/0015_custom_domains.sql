ALTER TABLE "podcast" ADD COLUMN "customDomainToken" text;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "customDomainVerifiedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "customDomainFailingSince" timestamp with time zone;