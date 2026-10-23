import { z } from 'zod'

export const playlistTitleMaxLength = 100
export const playlistDescriptionMaxLength = 500

export const playlistDetailsSchema = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(playlistTitleMaxLength),
  // Plain text; blank clears it.
  description: z
    .string()
    .trim()
    .max(playlistDescriptionMaxLength)
    .transform((value) => value || null),
  private: z.boolean(),
})

// A new playlist, and optionally the episode to put in it straight away.
export const createPlaylistSchema = playlistDetailsSchema.extend({ episodeId: z.string().min(1).optional() })

export const updatePlaylistSchema = playlistDetailsSchema.extend({ id: z.string().min(1) })

export const playlistEpisodeSchema = z.object({ playlistId: z.string().min(1), episodeId: z.string().min(1) })

export const reorderPlaylistSchema = z.object({
  playlistId: z.string().min(1),
  episodeIds: z.array(z.string().min(1)).max(1000),
})
