// Getting shows into directories: what each show still lacks before
// they'll list it, and submitting it to Podcast Index, the one directory with
// an API for that (the others are a form the owner fills in).
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { env } from '~/env'
import { directoryReadiness, isReady } from '~/lib/podcast-directories'
import { db } from '~/server/db/client.server'
import { shows, users } from '~/server/db/schema'
import { summarisePublishedEpisodes } from '~/server/episodes.server'
import { feedPath } from '~/server/feed.server'
import { reportError } from '~/server/logger.server'
import { showAuthor, showArtwork, updateDirectoryLink } from '~/server/shows.server'
import { siteUserAgent } from '~/server/branding.server'

// The readiness checklist for one of the user's shows; null if it isn't theirs.
export async function getDirectoryReadiness(userId: string, showId: string) {
  const [show] = await db
    .select({
      title: shows.title,
      description: shows.description,
      artwork: showArtwork,
      category: shows.category,
      language: shows.language,
      author: showAuthor,
      private: shows.private,
      ownerEmail: shows.ownerEmail,
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return null
  const { count } = await summarisePublishedEpisodes(showId)
  return directoryReadiness({ ...show, publishedEpisodes: count })
}

export const podcastIndexConfigured = () => Boolean(env.PODCASTINDEX_API_KEY && env.PODCASTINDEX_API_SECRET)

// Podcast Index's API signs each request with the key, secret and time.
async function podcastIndexHeaders() {
  const date = String(Math.floor(Date.now() / 1000))
  return {
    'User-Agent': await siteUserAgent(),
    'X-Auth-Key': env.PODCASTINDEX_API_KEY!,
    'X-Auth-Date': date,
    Authorization: createHash('sha1').update(`${env.PODCASTINDEX_API_KEY}${env.PODCASTINDEX_API_SECRET}${date}`).digest('hex'),
  }
}

type SubmitResult = { ok: true; link: string } | { ok: false; error: string }

// Adds the user's show to Podcast Index and remembers its listing there.
// It has to be ready for directories (see directoryReadiness) and public.
export async function submitToPodcastIndex(userId: string, showId: string, origin: string): Promise<SubmitResult> {
  if (!podcastIndexConfigured()) return { ok: false, error: 'Podcast Index submission isn’t set up on this site' }
  const readiness = await getDirectoryReadiness(userId, showId)
  if (!readiness) return { ok: false, error: 'There’s no such show' }
  if (!isReady(readiness)) return { ok: false, error: 'Your show isn’t ready for directories yet' }
  const [show] = await db.select({ slug: shows.slug }).from(shows).where(eq(shows.id, showId)).limit(1)
  const feedUrl = new URL(feedPath(show!.slug), origin).toString()

  try {
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { method: 'POST', headers: await podcastIndexHeaders() },
    )
    const body = (await response.json().catch(() => null)) as { status?: string; feedId?: number; description?: string } | null
    if (!response.ok || body?.status !== 'true' || !body.feedId) {
      throw new Error(`Podcast Index refused the feed (${response.status}): ${body?.description ?? 'no reason given'}`)
    }
    const link = `https://podcastindex.org/podcast/${body.feedId}`
    await updateDirectoryLink(userId, { id: showId, directory: 'podcastIndex', link })
    return { ok: true, link }
  } catch (error) {
    reportError(error, { msg: 'Submitting to Podcast Index failed', showId, feedUrl })
    return { ok: false, error: 'Podcast Index didn’t accept the show. Please try again later.' }
  }
}
