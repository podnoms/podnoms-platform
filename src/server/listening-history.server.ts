// What signed-in users play, download and share, kept against their account
// so admins can see what listeners do (on /admin/users/<id>). Separate from
// episode_activity (activity.server.ts), which never says who and is what
// show owners see; owners never see this.
// - Only kept while the user has keepListeningHistory on (/settings/privacy);
//   turning it off deletes what's been kept.
// - Each counts once a day for each episode and kind, as apps fetch audio in
//   many pieces.
// - Kept for a year (pruneListeningHistory, run daily).
import '@tanstack/react-start/server-only'
import { and, count, desc, eq, gte, lt, max } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, listeningEvents, shows, users, type ActivitySource, type ActivityType } from '~/server/db/schema'
import { showRefColumns } from '~/server/shows.server'

export const listeningHistoryKeepDays = 365

export type ListeningInput = {
  episodeId: string
  type: ActivityType
  source: ActivitySource
  detail?: 'link' | 'embed'
}

// Records it against the user, unless they've turned their history off or
// already did the same with the episode today. Resolves to whether it was
// recorded. Callers have already checked it isn't a crawler or an admin
// viewing the site as someone (see recordActivity).
export async function recordListening(userId: string, input: ListeningInput, now = new Date()) {
  const [user] = await db
    .select({ keep: users.keepListeningHistory })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user?.keep) return false
  const rows = await db
    .insert(listeningEvents)
    .values({
      userId,
      episodeId: input.episodeId,
      type: input.type,
      source: input.source,
      detail: input.detail ?? null,
      day: now.toISOString().slice(0, 10),
      occurredAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: listeningEvents.id })
  return rows.length > 0
}

export async function getKeepListeningHistory(userId: string) {
  const [user] = await db
    .select({ keep: users.keepListeningHistory })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.keep ?? null
}

// Turns the user's history on or off; off deletes what's been kept.
export async function setKeepListeningHistory(userId: string, keep: boolean) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ keepListeningHistory: keep }).where(eq(users.id, userId))
    if (!keep) await tx.delete(listeningEvents).where(eq(listeningEvents.userId, userId))
  })
}

export type ListeningHistory = Awaited<ReturnType<typeof listeningHistoryFor>>

// For the admin's page about the user: whether it's kept, how many of each
// kind in all and in the last 30 days, and the latest, newest first.
export async function listeningHistoryFor(userId: string, { limit = 50, now = new Date() } = {}) {
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [keep, totals, recentTotals, recent] = await Promise.all([
    getKeepListeningHistory(userId),
    db
      .select({ type: listeningEvents.type, count: count(), lastAt: max(listeningEvents.occurredAt) })
      .from(listeningEvents)
      .where(eq(listeningEvents.userId, userId))
      .groupBy(listeningEvents.type),
    db
      .select({ type: listeningEvents.type, count: count() })
      .from(listeningEvents)
      .where(and(eq(listeningEvents.userId, userId), gte(listeningEvents.occurredAt, monthAgo)))
      .groupBy(listeningEvents.type),
    db
      .select({
        id: listeningEvents.id,
        type: listeningEvents.type,
        source: listeningEvents.source,
        detail: listeningEvents.detail,
        occurredAt: listeningEvents.occurredAt,
        episodeId: episodes.id,
        episodeTitle: episodes.title,
        episodeSlug: episodes.slug,
        showTitle: shows.title,
        ...showRefColumns,
      })
      .from(listeningEvents)
      .innerJoin(episodes, eq(episodes.id, listeningEvents.episodeId))
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .innerJoin(users, eq(users.id, shows.userId))
      .where(eq(listeningEvents.userId, userId))
      .orderBy(desc(listeningEvents.occurredAt))
      .limit(limit),
  ])
  const kinds = ['play', 'download', 'share'] as const
  const byKind = Object.fromEntries(
    kinds.map((type) => {
      const total = totals.find((row) => row.type === type)
      return [
        type,
        {
          count: total?.count ?? 0,
          lastMonth: recentTotals.find((row) => row.type === type)?.count ?? 0,
          lastAt: total?.lastAt ?? null,
        },
      ]
    }),
  ) as Record<ActivityType, { count: number; lastMonth: number; lastAt: Date | null }>
  return { keep: keep ?? true, ...byKind, recent }
}

// Drops what's over listeningHistoryKeepDays old. Returns how many.
export async function pruneListeningHistory(now = new Date()) {
  const before = new Date(now.getTime() - listeningHistoryKeepDays * 24 * 60 * 60 * 1000)
  const pruned = await db
    .delete(listeningEvents)
    .where(lt(listeningEvents.occurredAt, before))
    .returning({ id: listeningEvents.id })
  return pruned.length
}
