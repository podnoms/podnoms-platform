CREATE TABLE "content_report" (
	"id" text PRIMARY KEY NOT NULL,
	"targetKind" text NOT NULL,
	"targetId" text NOT NULL,
	"imageUrl" text NOT NULL,
	"ownerId" text,
	"reason" text NOT NULL,
	"details" text,
	"reporterId" text,
	"reporterHash" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" text,
	"resolvedAt" timestamp with time zone,
	"resolvedById" text,
	"evidence" jsonb
);
--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_reporterId_user_id_fk" FOREIGN KEY ("reporterId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_resolvedById_user_id_fk" FOREIGN KEY ("resolvedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_report_resolvedAt_idx" ON "content_report" USING btree ("resolvedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "content_report_once_a_day_idx" ON "content_report" USING btree ("targetKind","targetId","imageUrl","reporterHash");