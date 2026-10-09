// Getting podcasts into directories: what each podcast still lacks before
// they'll list it, and submitting it to Podcast Index, the one directory with
// an API for that (the others are a form the owner fills in).
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { env } from '~/env'
import { directoryReadiness, isReady } from '~/lib/podcast-directories'
import { db } from '~/server/db/client.server'
import { podcasts, users } from '~/server/db/schema'
import { summarisePublishedEpisodes } from '~/server/episodes.server'
import { feedPath } from '~/server/feed.server'
import { reportError } from '~/server/logger.server'
import { podcastAuthor, podcastArtwork, updateDirectoryLink } from '~/server/podcasts.server'

// The readiness checklist for one of the user's podcasts; null if it isn't theirs.
export async function getDirectoryReadiness(userId: string, podcastId: string) {
  const [podcast] = await db
    .select({
      title: podcasts.title,
      description: podcasts.description,
      artwork: podcastArtwork,
      category: podcasts.category,
      language: podcasts.language,
      author: podcastAuthor,
      private: podcasts.private,
      ownerEmail: podcasts.ownerEmail,
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.userId))
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return null
  const { count } = await summarisePublishedEpisodes(podcastId)
  return directoryReadiness({ ...podcast, publishedEpisodes: count })
}

export const podcastIndexConfigured = () => Boolean(env.PODCASTINDEX_API_KEY && env.PODCASTINDEX_API_SECRET)

// Podcast Index's API signs each request with the key, secret and time.
function podcastIndexHeaders() {
  const date = String(Math.floor(Date.now() / 1000))
  return {
    'User-Agent': 'podnoms',
    'X-Auth-Key': env.PODCASTINDEX_API_KEY!,
    'X-Auth-Date': date,
    Authorization: createHash('sha1').update(`${env.PODCASTINDEX_API_KEY}${env.PODCASTINDEX_API_SECRET}${date}`).digest('hex'),
  }
}

type SubmitResult = { ok: true; link: string } | { ok: false; error: string }

// Adds the user's podcast to Podcast Index and remembers its listing there.
// It has to be ready for directories (see directoryReadiness) and public.
export async function submitToPodcastIndex(userId: string, podcastId: string, origin: string): Promise<SubmitResult> {
  if (!podcastIndexConfigured()) return { ok: false, error: 'Podcast Index submission isn’t set up on this site' }
  const readiness = await getDirectoryReadiness(userId, podcastId)
  if (!readiness) return { ok: false, error: 'There’s no such podcast' }
  if (!isReady(readiness)) return { ok: false, error: 'Your podcast isn’t ready for directories yet' }
  const [podcast] = await db.select({ slug: podcasts.slug }).from(podcasts).where(eq(podcasts.id, podcastId)).limit(1)
  const feedUrl = new URL(feedPath(podcast!.slug), origin).toString()

  try {
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { method: 'POST', headers: podcastIndexHeaders() },
    )
    const body = (await response.json().catch(() => null)) as { status?: string; feedId?: number; description?: string } | null
    if (!response.ok || body?.status !== 'true' || !body.feedId) {
      throw new Error(`Podcast Index refused the feed (${response.status}): ${body?.description ?? 'no reason given'}`)
    }
    const link = `https://podcastindex.org/podcast/${body.feedId}`
    await updateDirectoryLink(userId, { id: podcastId, directory: 'podcastIndex', link })
    return { ok: true, link }
  } catch (error) {
    reportError(error, { msg: 'Submitting to Podcast Index failed', podcastId, feedUrl })
    return { ok: false, error: 'Podcast Index didn’t accept the podcast. Please try again later.' }
  }
}
