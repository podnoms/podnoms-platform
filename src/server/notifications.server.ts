// Emails to podcast owners about their podcasts: episodes that couldn't be
// processed, and new episodes from a channel. Events are collected for a few
// minutes and sent as one email, so a bulk upload that fails doesn't send one
// email per episode. Like episode progress, batches waiting to be sent are
// kept in memory and lost if the app restarts.
import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, users } from '~/server/db/schema'
import { emailEnabled, emailOrigin, sendEmail } from '~/server/email.server'
import { notificationDigestEmail, type NotificationEvent } from '~/server/emails.server'
import { reportError } from '~/server/logger.server'

export const batchDelayMs = 5 * 60_000

type Preference = 'notifyEpisodeFailed' | 'notifyNewEpisodes'

const batches = new Map<string, NotificationEvent[]>()

const link = (path: string) => {
  const origin = emailOrigin()
  return origin ? new URL(path, origin).toString() : null
}

// Adds the event to the user's next email, if they want this kind and the site
// can send email.
async function queue(userId: string, preference: Preference, event: NotificationEvent) {
  if (!(await emailEnabled())) return
  const [user] = await db
    .select({ wants: users[preference] })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user?.wants) return
  const batch = batches.get(userId)
  if (batch) {
    batch.push(event)
    return
  }
  batches.set(userId, [event])
  setTimeout(() => void flush(userId), batchDelayMs).unref?.()
}

async function flush(userId: string) {
  const events = batches.get(userId)
  batches.delete(userId)
  if (!events?.length) return
  try {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
    if (!user?.email) return
    await sendEmail({ to: user.email, ...notificationDigestEmail(events, link('/settings/notifications')) })
  } catch (error) {
    reportError(error, { msg: 'Sending a notification email failed', userId })
  }
}

// Notifications never get in the way of what they're about.
const safely = (work: Promise<void>) =>
  void work.catch((error: unknown) => reportError(error, { msg: 'Queueing a notification failed' }))

export function notifyEpisodeFailed(episodeId: string, error: string | null) {
  safely(
    (async () => {
      const [row] = await db
        .select({
          userId: podcasts.userId,
          podcastTitle: podcasts.title,
          podcastSlug: podcasts.slug,
          episodeTitle: episodes.title,
          episodeSlug: episodes.slug,
        })
        .from(episodes)
        .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
        .where(eq(episodes.id, episodeId))
        .limit(1)
      if (!row) return
      await queue(row.userId, 'notifyEpisodeFailed', {
        type: 'episodeFailed',
        podcastTitle: row.podcastTitle,
        episodeTitle: row.episodeTitle,
        error,
        link: link(`/podcasts/${row.podcastSlug}/episodes/${row.episodeSlug}/manage`),
      })
    })(),
  )
}

export function notifyNewEpisodes(podcastId: string, count: number) {
  if (count <= 0) return
  safely(
    (async () => {
      const [podcast] = await db
        .select({ userId: podcasts.userId, title: podcasts.title, slug: podcasts.slug })
        .from(podcasts)
        .where(eq(podcasts.id, podcastId))
        .limit(1)
      if (!podcast) return
      await queue(podcast.userId, 'notifyNewEpisodes', {
        type: 'newEpisodes',
        podcastTitle: podcast.title,
        count,
        link: link(`/podcasts/${podcast.slug}/manage`),
      })
    })(),
  )
}

// For tests: sends every waiting batch now.
export async function flushAllNotifications() {
  await Promise.all([...batches.keys()].map(flush))
}
