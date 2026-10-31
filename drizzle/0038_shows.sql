-- Podcasts are now called shows: rename the tables, their columns and every
-- constraint and index named after them, keeping the data.
ALTER TABLE "podcast" RENAME TO "show";--> statement-breakpoint
ALTER TABLE "podcast_tag" RENAME TO "show_tag";--> statement-breakpoint
ALTER TABLE "podcast_follow" RENAME TO "show_follow";--> statement-breakpoint
ALTER TABLE "episode" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "show_tag" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "channel" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "show_follow" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "live_broadcast" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "episode_activity" RENAME COLUMN "podcastId" TO "showId";--> statement-breakpoint
ALTER TABLE "show" RENAME CONSTRAINT "podcast_pkey" TO "show_pkey";--> statement-breakpoint
ALTER TABLE "show" RENAME CONSTRAINT "podcast_slug_unique" TO "show_slug_unique";--> statement-breakpoint
ALTER TABLE "show" RENAME CONSTRAINT "podcast_customDomain_unique" TO "show_customDomain_unique";--> statement-breakpoint
ALTER TABLE "show" RENAME CONSTRAINT "podcast_userId_user_id_fk" TO "show_userId_user_id_fk";--> statement-breakpoint
ALTER TABLE "episode" RENAME CONSTRAINT "episode_podcastId_podcast_id_fk" TO "episode_showId_show_id_fk";--> statement-breakpoint
ALTER TABLE "show_tag" RENAME CONSTRAINT "podcast_tag_podcastId_tagId_pk" TO "show_tag_showId_tagId_pk";--> statement-breakpoint
ALTER TABLE "show_tag" RENAME CONSTRAINT "podcast_tag_podcastId_podcast_id_fk" TO "show_tag_showId_show_id_fk";--> statement-breakpoint
ALTER TABLE "show_tag" RENAME CONSTRAINT "podcast_tag_tagId_tag_id_fk" TO "show_tag_tagId_tag_id_fk";--> statement-breakpoint
ALTER TABLE "channel" RENAME CONSTRAINT "channel_podcastId_podcast_id_fk" TO "channel_showId_show_id_fk";--> statement-breakpoint
ALTER TABLE "show_follow" RENAME CONSTRAINT "podcast_follow_userId_podcastId_pk" TO "show_follow_userId_showId_pk";--> statement-breakpoint
ALTER TABLE "show_follow" RENAME CONSTRAINT "podcast_follow_podcastId_podcast_id_fk" TO "show_follow_showId_show_id_fk";--> statement-breakpoint
ALTER TABLE "show_follow" RENAME CONSTRAINT "podcast_follow_userId_user_id_fk" TO "show_follow_userId_user_id_fk";--> statement-breakpoint
ALTER TABLE "live_broadcast" RENAME CONSTRAINT "live_broadcast_podcastId_podcast_id_fk" TO "live_broadcast_showId_show_id_fk";--> statement-breakpoint
ALTER TABLE "episode_activity" RENAME CONSTRAINT "episode_activity_podcastId_podcast_id_fk" TO "episode_activity_showId_show_id_fk";--> statement-breakpoint
ALTER INDEX "podcast_userId_idx" RENAME TO "show_userId_idx";--> statement-breakpoint
ALTER INDEX "episode_podcastId_publishedAt_idx" RENAME TO "episode_showId_publishedAt_idx";--> statement-breakpoint
ALTER INDEX "episode_podcastId_slug_idx" RENAME TO "episode_showId_slug_idx";--> statement-breakpoint
ALTER INDEX "podcast_tag_tagId_idx" RENAME TO "show_tag_tagId_idx";--> statement-breakpoint
ALTER INDEX "channel_podcastId_idx" RENAME TO "channel_showId_idx";--> statement-breakpoint
ALTER INDEX "podcast_follow_podcastId_idx" RENAME TO "show_follow_showId_idx";--> statement-breakpoint
ALTER INDEX "live_broadcast_podcastId_startedAt_idx" RENAME TO "live_broadcast_showId_startedAt_idx";--> statement-breakpoint
ALTER INDEX "episode_activity_podcastId_occurredAt_idx" RENAME TO "episode_activity_showId_occurredAt_idx";--> statement-breakpoint
-- Reports of a show's image were stored as 'podcast' (ReportTargetKind).
UPDATE "content_report" SET "targetKind" = 'show' WHERE "targetKind" = 'podcast';
