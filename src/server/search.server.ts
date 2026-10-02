// Searches the user's podcasts and episodes by title and description, for
// the search box in the top nav.
import '@tanstack/react-start/server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, podcasts } from '~/server/db/schema'

const maxPodcasts = 5
const maxEpisodes = 10

// A LIKE pattern matching `text` anywhere, its wildcards taken literally.
function containing(text: string) {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}

// Descriptions are HTML: match their text, not their tags.
function descriptionText(column: AnyPgColumn) {
  return sql`regexp_replace(coalesce(${column}, ''), '<[^>]*>', ' ', 'g')`
}

// Title matches before those only in the description.
function titleFirst(title: AnyPgColumn, pattern: string): SQL {
  return sql`case when ${title} ilike ${pattern} then 0 else 1 end`
}

// The part of a description around the first match, when the match is in the
// description (not in the title).
function excerpt(title: string, description: string | null, query: string) {
  if (!description || title.toLowerCase().includes(query.toLowerCase())) return null
  const text = htmlToText(description).replace(/\s+/g, ' ')
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return null
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + query.length + 80)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export async function searchLibrary(userId: string, query: string) {
  const pattern = containing(query)

  const [podcastRows, episodeRows] = await Promise.all([
    db
      .select({
        id: podcasts.id,
        title: podcasts.title,
        slug: podcasts.slug,
        description: podcasts.description,
        imageUrl: podcasts.imageUrl,
      })
      .from(podcasts)
      .where(
        and(
          eq(podcasts.userId, userId),
          or(ilike(podcasts.title, pattern), sql`${descriptionText(podcasts.description)} ilike ${pattern}`),
        ),
      )
      .orderBy(titleFirst(podcasts.title, pattern), podcasts.title)
      .limit(maxPodcasts),
    db
      .select({
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        description: episodes.description,
        imageUrl: sql<string | null>`coalesce(${episodes.imageUrl}, ${podcasts.imageUrl})`,
        podcastTitle: podcasts.title,
        podcastSlug: podcasts.slug,
      })
      .from(episodes)
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(
        and(
          eq(podcasts.userId, userId),
          or(ilike(episodes.title, pattern), sql`${descriptionText(episodes.description)} ilike ${pattern}`),
        ),
      )
      .orderBy(titleFirst(episodes.title, pattern), desc(episodes.createdAt))
      .limit(maxEpisodes),
  ])

  return {
    podcasts: podcastRows.map(({ description, ...podcast }) => ({
      ...podcast,
      excerpt: excerpt(podcast.title, description, query),
    })),
    episodes: episodeRows.map(({ description, ...episode }) => ({
      ...episode,
      excerpt: excerpt(episode.title, description, query),
    })),
  }
}

export type SearchResults = Awaited<ReturnType<typeof searchLibrary>>
