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
ALTER TABLE "user" ADD COLUMN "totpSecret" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totpLastStep" integer;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_key" ADD CONSTRAINT "security_key_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_key_userId_idx" ON "security_key" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "verificationToken" RENAME TO "verification_token";--> statement-breakpoint
ALTER TABLE "verification_token" RENAME CONSTRAINT "verificationToken_identifier_token_pk" TO "verification_token_identifier_token_pk";