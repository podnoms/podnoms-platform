// Tracked links: links to an episode's share page that its owner makes for
// particular people ("Sent to Alex"), to see whether they opened it and
// pressed play. Kept apart from episode_activity, which never identifies
// anyone: here only counts and times are kept for each link, nothing about
// the visitor. Opens and plays are reported by the share page in the browser
// (see /api/tracked-links/$token), so link previews (Slack, iMessage and the
// like, which don't run scripts) don't count as opening it.
import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, trackedLinks } from '~/server/db/schema'
import { isBot } from '~/server/user-agent.server'
import type { TrackedLinkVisit } from '~/lib/tracked-link-schema'

const ownedBy = (userId: string) => and(eq(podcasts.userId, userId), eq(podcasts.id, episodes.podcastId))

// The user's episode's id, or null if it isn't theirs.
async function ownEpisode(userId: string, episodeId: string) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(podcasts, ownedBy(userId))
    .where(eq(episodes.id, episodeId))
    .limit(1)
  return row?.id ?? null
}

// The episode's tracked links, newest first, if the episode is the user's.
export async function listTrackedLinks(userId: string, episodeId: string) {
  return db
    .select({
      id: trackedLinks.id,
      token: trackedLinks.token,
      label: trackedLinks.label,
      openCount: trackedLinks.openCount,
      firstOpenedAt: trackedLinks.firstOpenedAt,
      lastOpenedAt: trackedLinks.lastOpenedAt,
      playCount: trackedLinks.playCount,
      lastPlayedAt: trackedLinks.lastPlayedAt,
      createdAt: trackedLinks.createdAt,
    })
    .from(trackedLinks)
    .innerJoin(episodes, eq(episodes.id, trackedLinks.episodeId))
    .innerJoin(podcasts, ownedBy(userId))
    .where(eq(trackedLinks.episodeId, episodeId))
    .orderBy(desc(trackedLinks.createdAt), desc(trackedLinks.id))
}

export type TrackedLink = Awaited<ReturnType<typeof listTrackedLinks>>[number]

export async function createTrackedLink(userId: string, episodeId: string, label: string) {
  if (!(await ownEpisode(userId, episodeId))) throw new Error('Episode not found')
  const [link] = await db.insert(trackedLinks).values({ episodeId, label }).returning({ id: trackedLinks.id })
  return link!
}

// Resolves to whether the link was the user's to delete.
export async function deleteTrackedLink(userId: string, id: string) {
  const rows = await db
    .delete(trackedLinks)
    .where(
      and(
        eq(trackedLinks.id, id),
        inArray(trackedLinks.episodeId, db.select({ id: episodes.id }).from(episodes).innerJoin(podcasts, ownedBy(userId))),
      ),
    )
    .returning({ id: trackedLinks.id })
  return rows.length > 0
}

// Counts an open or play of the link, unless it's from a crawler, the
// episode's owner (trying their own link), or the token isn't the episode's.
// Resolves to whether it was counted.
export async function recordTrackedLinkVisit(
  token: string,
  visit: TrackedLinkVisit,
  { userAgent, viewerId }: { userAgent: string | null; viewerId: string | null },
) {
  if (isBot(userAgent)) return false
  const [link] = await db
    .select({ id: trackedLinks.id, ownerId: podcasts.userId })
    .from(trackedLinks)
    .innerJoin(episodes, eq(episodes.id, trackedLinks.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(trackedLinks.token, token), eq(trackedLinks.episodeId, visit.episodeId)))
    .limit(1)
  if (!link || link.ownerId === viewerId) return false

  const now = sql`now()`
  await db
    .update(trackedLinks)
    .set(
      visit.type === 'open'
        ? {
            openCount: sql`${trackedLinks.openCount} + 1`,
            firstOpenedAt: sql`coalesce(${trackedLinks.firstOpenedAt}, now())`,
            lastOpenedAt: now,
          }
        : { playCount: sql`${trackedLinks.playCount} + 1`, lastPlayedAt: now },
    )
    .where(eq(trackedLinks.id, link.id))
  return true
}
