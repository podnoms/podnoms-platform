// Episode slugs, for episode URLs. Unique within a show.
import '@tanstack/react-start/server-only'
import { and, eq, like, or } from 'drizzle-orm'
import { reservedEpisodeSlugs } from '~/lib/paths'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { db } from '~/server/db/client.server'
import { episodes } from '~/server/db/schema'

// A slug from the title that no other episode in the show has, and that isn't
// one of reservedEpisodeSlugs.
export async function availableEpisodeSlug(showId: string, title: string, episodeId?: string) {
  const base = slugify(title, 'episode')
  const rows = await db
    .select({ id: episodes.id, slug: episodes.slug })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), or(eq(episodes.slug, base), like(episodes.slug, `${base}-%`))))
  const taken = rows.filter((row) => row.id !== episodeId).map((row) => row.slug)
  return firstFreeSlug(base, new Set([...reservedEpisodeSlugs, ...taken]))
}

// For an episode whose title isn't known yet (a link that hasn't been
// fetched). It's replaced with one from the real title once it is.
export function temporaryEpisodeSlug() {
  return `episode-${crypto.randomUUID().slice(0, 8)}`
}

// Another episode took the slug between choosing it and saving it. Rare;
// a random suffix settles it.
export function isSlugConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  // Drizzle wraps the database's error in its own.
  if ('cause' in error && isSlugConflict(error.cause)) return true
  const { code, constraint_name } = error as { code?: string; constraint_name?: string }
  return code === '23505' && constraint_name === 'episode_showId_slug_idx'
}

export function withRandomSuffix(slug: string) {
  return `${slug}-${crypto.randomUUID().slice(0, 4)}`
}
