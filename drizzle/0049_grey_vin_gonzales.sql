CREATE TABLE "ignored_show" (
	"userId" text NOT NULL,
	"showId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ignored_show_userId_showId_pk" PRIMARY KEY("userId","showId")
);
--> statement-breakpoint
ALTER TABLE "ignored_show" ADD CONSTRAINT "ignored_show_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ignored_show" ADD CONSTRAINT "ignored_show_showId_show_id_fk" FOREIGN KEY ("showId") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;