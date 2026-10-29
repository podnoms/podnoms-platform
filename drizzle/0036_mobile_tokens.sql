CREATE TABLE "auth"."mobile_token" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"deviceName" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."mobile_token" ADD CONSTRAINT "mobile_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_token_userId_idx" ON "auth"."mobile_token" USING btree ("userId");