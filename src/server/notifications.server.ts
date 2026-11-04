// Notification emails (each also goes in the notifications menu, see
// inbox.server.ts, whether or not it's emailed): to show owners about their shows (episodes that
// couldn't be processed, and new episodes from a channel), and to listeners
// about the shows they follow (new episodes, and going live; see
// follower-notifications.server.ts). Events are collected for a few minutes
// and sent as one email, so a bulk upload that fails doesn't send one email
// per episode; going live is sent at once. Like episode progress, batches
// waiting to be sent are kept in memory and lost if the app restarts.
import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { episodeManagePath, episodePath, livePath, showManagePath, showPath, type ShowRef } from '~/lib/paths'
import { db } from '~/server/db/client.server'
import { episodes, shows, users } from '~/server/db/schema'

// What a show's address needs (see ShowRef). Needs the user table joined.
const showRefColumns = { slug: shows.slug, ownerSlug: users.slug }
import { emailEnabled, emailOrigin, sendEmail } from '~/server/email.server'
import { liveEmail, notificationDigestEmail, type NotificationEvent } from '~/server/emails.server'
import { recordNotification } from '~/server/inbox.server'
import { reportError } from '~/server/logger.server'
import { getBranding } from '~/server/branding.server'

export const batchDelayMs = 5 * 60_000

type Preference = 'notifyEpisodeFailed' | 'notifyNewEpisodes' | 'emailFollowedEpisodes' | 'emailLive' | 'emailMentions'

const batches = new Map<string, NotificationEvent[]>()

const link = (path: string) => {
  const origin = emailOrigin()
  return origin ? new URL(path, origin).toString() : null
}

// The user's address, if they want this kind of email and the site can send
// email.
async function addressFor(userId: string, preference: Preference) {
  if (!(await emailEnabled())) return null
  const [user] = await db
    .select({ wants: users[preference], email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.wants ? user.email : null
}

// Adds the event to the user's next email, if they want this kind and the site
// can send email.
async function queue(userId: string, preference: Preference, event: NotificationEvent) {
  if (!(await addressFor(userId, preference))) return
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
    await sendEmail({ to: user.email, ...notificationDigestEmail(events, link('/settings/notifications'), (await getBranding()).name) })
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
          userId: shows.userId,
          showTitle: shows.title,
          show: showRefColumns,
          episodeTitle: episodes.title,
          episodeSlug: episodes.slug,
        })
        .from(episodes)
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .innerJoin(users, eq(users.id, shows.userId))
        .where(eq(episodes.id, episodeId))
        .limit(1)
      if (!row) return
      await recordNotification([row.userId], {
        kind: 'episodeFailed',
        title: `${row.episodeTitle} couldn’t be processed`,
        body: error ?? row.showTitle,
        url: episodeManagePath(row.show, row.episodeSlug),
      })
      await queue(row.userId, 'notifyEpisodeFailed', {
        type: 'episodeFailed',
        showTitle: row.showTitle,
        episodeTitle: row.episodeTitle,
        error,
        link: link(episodeManagePath(row.show, row.episodeSlug)),
      })
    })(),
  )
}

export function notifyNewEpisodes(showId: string, count: number) {
  if (count <= 0) return
  safely(
    (async () => {
      const [show] = await db
        .select({ userId: shows.userId, title: shows.title, ...showRefColumns })
        .from(shows)
        .innerJoin(users, eq(users.id, shows.userId))
        .where(eq(shows.id, showId))
        .limit(1)
      if (!show) return
      await recordNotification([show.userId], {
        kind: 'channelEpisodes',
        title: `${count === 1 ? 'A new episode' : `${count} new episodes`} from ${show.title}’s channel`,
        url: showManagePath(show),
      })
      await queue(show.userId, 'notifyNewEpisodes', {
        type: 'newEpisodes',
        showTitle: show.title,
        count,
        link: link(showManagePath(show)),
      })
    })(),
  )
}

// New episodes from a show the user follows, for their next email.
export function emailFollowedEpisodes(
  userId: string,
  show: ShowRef & { title: string },
  episodes: { title: string; slug: string }[],
) {
  if (!episodes.length) return
  safely(
    queue(userId, 'emailFollowedEpisodes', {
      type: 'followedEpisodes',
      showTitle: show.title,
      titles: episodes.map((episode) => episode.title),
      link: link(episodes.length === 1 ? episodePath(show, episodes[0]!.slug) : showPath(show)),
    }),
  )
}

// A show the user follows has gone live: sent at once, as it won't wait.
export function emailFollowerLive(userId: string, show: ShowRef & { title: string }, broadcastTitle: string) {
  safely(
    (async () => {
      const to = await addressFor(userId, 'emailLive')
      if (!to) return
      await sendEmail({
        to,
        ...liveEmail(show.title, broadcastTitle, link(livePath(show)), link('/settings/notifications')),
      })
    })(),
  )
}

// Someone mentioned the user in a comment, or replied to theirs, for their
// next email.
export function emailCommentNotice(userId: string, event: Extract<NotificationEvent, { type: 'comment' }>) {
  safely(queue(userId, 'emailMentions', event))
}

// For tests: sends every waiting batch now.
export async function flushAllNotifications() {
  await Promise.all([...batches.keys()].map(flush))
}
