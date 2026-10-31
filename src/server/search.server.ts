// Searches the user's shows and episodes by title and description, for
// the search box in the top nav.
import '@tanstack/react-start/server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, shows } from '~/server/db/schema'
import { isPublished } from '~/server/episodes.server'

const maxShows = 5
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

  const [showRows, episodeRows] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.title,
        slug: shows.slug,
        description: shows.description,
        imageUrl: shows.imageUrl,
      })
      .from(shows)
      .where(
        and(
          eq(shows.userId, userId),
          or(ilike(shows.title, pattern), sql`${descriptionText(shows.description)} ilike ${pattern}`),
        ),
      )
      .orderBy(titleFirst(shows.title, pattern), shows.title)
      .limit(maxShows),
    db
      .select({
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        description: episodes.description,
        imageUrl: sql<string | null>`coalesce(${episodes.imageUrl}, ${shows.imageUrl})`,
        showTitle: shows.title,
        showSlug: shows.slug,
        // Whether it has a public page yet.
        ready: sql<boolean>`${isPublished}`,
      })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(
        and(
          eq(shows.userId, userId),
          or(ilike(episodes.title, pattern), sql`${descriptionText(episodes.description)} ilike ${pattern}`),
        ),
      )
      .orderBy(titleFirst(episodes.title, pattern), desc(episodes.createdAt))
      .limit(maxEpisodes),
  ])

  return {
    shows: showRows.map(({ description, ...show }) => ({
      ...show,
      excerpt: excerpt(show.title, description, query),
    })),
    episodes: episodeRows.map(({ description, ...episode }) => ({
      ...episode,
      excerpt: excerpt(episode.title, description, query),
    })),
  }
}

export type SearchResults = Awaited<ReturnType<typeof searchLibrary>>
