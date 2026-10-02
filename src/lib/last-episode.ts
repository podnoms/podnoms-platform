import { z } from 'zod'

// The episode last loaded in the player, remembered in this browser so it's
// queued up again after a reload.
const lastEpisodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  audioUrl: z.string(),
  imageUrl: z.string().nullable(),
  podcastTitle: z.string(),
  positionSeconds: z.number().nullable(),
})
export type LastEpisode = z.infer<typeof lastEpisodeSchema>

const STORAGE_KEY = 'player-episode'

export function readLastEpisode(): LastEpisode | null {
  try {
    const parsed = lastEpisodeSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    // Storage can be unavailable (private mode, blocked site data), or hold junk.
    return null
  }
}

// Null forgets it.
export function storeLastEpisode(episode: LastEpisode | null) {
  try {
    if (episode) localStorage.setItem(STORAGE_KEY, JSON.stringify(episode))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Only matters for the next visit.
  }
}
