// The notifications menu in the top bar: everything a user has been told
// about, or could have been, by email or desktop notification, whatever
// they've chosen for those, so turning them off loses nothing. Each notifier
// records here as well as emailing and pushing (see notifications.server.ts,
// follower-notifications.server.ts, comment-notifications.server.ts and
// admin-alerts.server.ts). Kept for 90 days (pruneNotifications, run daily).
import '@tanstack/react-start/server-only'
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { notifications } from '~/server/db/schema'

// What it's about, for its icon.
export type NotificationKind =
  | 'episodeFailed'
  | 'channelEpisodes'
  | 'live'
  | 'followedEpisodes'
  | 'mention'
  | 'reply'
  | 'botCheck'
  | 'blockedImage'
  | 'contentReport'

export type InboxItem = {
  kind: NotificationKind
  title: string
  body?: string | null
  // A path on the site.
  url: string
  image?: string | null
}

export const inboxPageSize = 30
export const inboxKeepDays = 90

export async function recordNotification(userIds: string[], item: InboxItem) {
  if (!userIds.length) return
  await db.insert(notifications).values(
    userIds.map((userId) => ({
      userId,
      kind: item.kind,
      title: item.title,
      body: item.body ?? null,
      url: item.url,
      image: item.image ?? null,
    })),
  )
}

// The user's newest notifications, and how many they haven't read.
export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
        image: notifications.image,
        read: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(inboxPageSize),
    countUnread(userId),
  ])
  return {
    items: items.map(({ read, kind, ...item }) => ({ ...item, kind: kind as NotificationKind, read: read !== null })),
    unread,
  }
}

export type Notification = Awaited<ReturnType<typeof listNotifications>>['items'][number]

export async function countUnread(userId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return row!.count
}

// Marks the user's notifications read: these ones, or all of them.
export async function markNotificationsRead(userId: string, ids?: string[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    )
}

// Drops notifications older than inboxKeepDays. Returns how many.
export async function pruneNotifications(now = new Date()) {
  const before = new Date(now.getTime() - inboxKeepDays * 24 * 60 * 60 * 1000)
  const pruned = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, before))
    .returning({ id: notifications.id })
  return pruned.length
}
