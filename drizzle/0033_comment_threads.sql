CREATE TABLE "comment_like" (
	"userId" text NOT NULL,
	"commentId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_like_userId_commentId_pk" PRIMARY KEY("userId","commentId")
);
--> statement-breakpoint
CREATE TABLE "comment_mention" (
	"commentId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "comment_mention_commentId_userId_pk" PRIMARY KEY("commentId","userId")
);
--> statement-breakpoint
ALTER TABLE "episode_comment" ADD COLUMN "parentId" text;--> statement-breakpoint
-- Every existing user gets a slug from their name, or their email's local part,
-- lowercased with anything but letters and digits made a hyphen, at most 30
-- characters; "user" if that leaves under 2. Taken ones get -2, -3...
ALTER TABLE "user" ADD COLUMN "slug" text;--> statement-breakpoint
DO $$
DECLARE
  u record;
  base text;
  candidate text;
  n integer;
BEGIN
  FOR u IN SELECT "id", "name", "email" FROM "user" ORDER BY "id" LOOP
    base := regexp_replace(lower(coalesce(nullif(trim(u."name"), ''), split_part(coalesce(u."email", ''), '@', 1))), '[^a-z0-9]+', '-', 'g');
    base := trim(both '-' from left(trim(both '-' from base), 30));
    IF length(base) < 2 THEN base := 'user'; END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM "user" WHERE "slug" = candidate) LOOP
      n := n + 1;
      candidate := trim(both '-' from left(base, 26)) || '-' || n;
    END LOOP;
    UPDATE "user" SET "slug" = candidate WHERE "id" = u."id";
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "pushMentions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "emailMentions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_commentId_episode_comment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."episode_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mention" ADD CONSTRAINT "comment_mention_commentId_episode_comment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."episode_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mention" ADD CONSTRAINT "comment_mention_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_like_commentId_idx" ON "comment_like" USING btree ("commentId");--> statement-breakpoint
CREATE INDEX "comment_mention_userId_idx" ON "comment_mention" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "episode_comment" ADD CONSTRAINT "episode_comment_parentId_episode_comment_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."episode_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_comment_parentId_idx" ON "episode_comment" USING btree ("parentId");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_slug_unique" UNIQUE("slug");