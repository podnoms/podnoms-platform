import { z } from 'zod'

// Show pages load this many episodes at first, and this many more each time
// the list is scrolled to its end.
export const episodePageSize = 10

// Episodes after the first page of a podcast's list. A page that reloads asks
// for every episode it had loaded at once, so the limit is generous.
export const episodePageSchema = z.object({
  slug: z.string(),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(1000),
})
