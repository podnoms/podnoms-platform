-- What directories (Apple Podcasts, Spotify...) need: a subcategory, the
-- author and owner email shown in the feed, and links to the podcast's
-- listings. Categories must now be Apple's, so any other value is cleared
-- (keep this list in step with appleCategories in src/lib/podcast-directories.ts).
ALTER TABLE "podcast" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "ownerEmail" text;--> statement-breakpoint
ALTER TABLE "podcast" ADD COLUMN "directoryLinks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "podcast" SET "category" = NULL
WHERE "category" IS NOT NULL AND "category" NOT IN (
  'Arts', 'Business', 'Comedy', 'Education', 'Fiction', 'Government', 'History', 'Health & Fitness',
  'Kids & Family', 'Leisure', 'Music', 'News', 'Religion & Spirituality', 'Science', 'Society & Culture',
  'Sports', 'Technology', 'True Crime', 'TV & Film'
);