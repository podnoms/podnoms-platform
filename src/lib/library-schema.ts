import { z } from 'zod'

export const likeEpisodeSchema = z.object({ episodeId: z.string().min(1), liked: z.boolean() })
export const followPodcastSchema = z.object({ podcastId: z.string().min(1), following: z.boolean() })

// A slice of a list that loads more as it's scrolled (see useEpisodePages).
export const listPageSchema = z.object({
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(1000),
})
