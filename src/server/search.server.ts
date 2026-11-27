// Searches the user's shows and episodes by title and description, and
// everyone's profiles by name and @slug, for the search box in the top nav.
import '@tanstack/react-start/server-only'
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { containing, escapeLike } from '~/lib/like-pattern'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, shows, users } from '~/server/db/schema'
import { isPublished } from '~/server/episodes.server'
import { episodeArtwork, showArtwork } from '~/server/shows.server'

const maxShows = 5
const maxEpisodes = 10
const maxPeople = 5


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

  // A leading @ means a slug, as in mentions and bylines.
  const slugQuery = query.replace(/^@/, '')
  const slugMatch = ilike(users.slug, containing(slugQuery))
  const slugStart = ilike(users.slug, `${escapeLike(slugQuery)}%`)

  const [showRows, episodeRows, people] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.title,
        slug: shows.slug,
        ownerSlug: users.slug,
        description: shows.description,
        imageUrl: showArtwork,
      })
      .from(shows)
      .innerJoin(users, eq(users.id, shows.userId))
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
        imageUrl: episodeArtwork,
        showTitle: shows.title,
        showSlug: shows.slug,
        ownerSlug: users.slug,
        // Whether it has a public page yet.
        ready: sql<boolean>`${isPublished}`,
      })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .innerJoin(users, eq(users.id, shows.userId))
      .where(
        and(
          eq(shows.userId, userId),
          or(ilike(episodes.title, pattern), sql`${descriptionText(episodes.description)} ilike ${pattern}`),
        ),
      )
      .orderBy(titleFirst(episodes.title, pattern), desc(episodes.createdAt))
      .limit(maxEpisodes),
    // Anyone whose profile others can see: not excluded (see setUserExcluded,
    // whose profiles disappear for everyone else), disabled or on hold.
    db
      .select({ id: users.id, slug: users.slug, name: users.name, image: users.image })
      .from(users)
      .where(
        and(
          or(slugMatch, ilike(users.name, pattern)),
          or(isNull(users.excludedAt), eq(users.id, userId)),
          isNull(users.disabledAt),
          isNull(users.onHoldAt),
        ),
      )
      // Slugs starting with the query first, then other slug matches, then names.
      .orderBy(
        sql`case when ${slugStart} then 0 when ${slugMatch} then 1 else 2 end`,
        users.slug,
      )
      .limit(maxPeople),
  ])

  return {
    people,
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
