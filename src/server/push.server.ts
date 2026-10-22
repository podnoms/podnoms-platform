// Desktop notifications (Web Push) to listeners about the podcasts they
// follow: when one goes live, and when it has new episodes. Each browser a
// user turns them on in (on /settings/notifications) has a push_subscription,
// and the service worker (public/push-sw.js) shows what's sent. Users choose
// which kinds they get, and can mute a podcast they follow.
//
// The site's VAPID keys, which push services know it by, are made on first
// use and kept as the app's own "__pushKeys" in site_settings, the private
// key encrypted. Changing AUTH_SECRET makes new ones, after which browsers
// have to turn notifications on again.
//
// New episodes are collected per podcast for a couple of minutes and sent as
// one notification, so a channel's import doesn't send one per episode. Like
// email notifications, what's waiting is kept in memory.
import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm'
import webpush, { WebPushError } from 'web-push'
import { z } from 'zod'
import { episodePath, livePath, podcastPath } from '~/lib/paths'
import { db } from '~/server/db/client.server'
import { episodes, podcastFollows, podcasts, pushSubscriptions, siteSettings, users } from '~/server/db/schema'
import { isListed } from '~/server/episodes.server'
import { logger, reportError } from '~/server/logger.server'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'
import { internalKeyPrefix } from '~/server/site-settings.server'
import { siteOrigin } from '~/server/site-url.server'
import { describeUserAgent } from '~/server/user-agent.server'

export const pushKeysKey = `${internalKeyPrefix}pushKeys`
const storedKeys = z.object({ publicKey: z.string(), privateKey: z.string() })

export const episodeBatchDelayMs = 2 * 60_000
// Episodes dated further back than this (a channel's back catalogue, say)
// aren't news.
export const newEpisodeMaxAgeMs = 7 * 24 * 60 * 60_000

// What the service worker shows. `url` is opened when it's clicked; a newer
// notification with the same `tag` replaces an older one.
export type PushMessage = { title: string; body: string; url: string; icon: string | null; tag: string }

type PushPref = 'pushLive' | 'pushNewEpisodes'

// Made once, by whichever server gets there first.
let keys: Promise<{ publicKey: string; privateKey: string }> | undefined

export function getPushKeys() {
  keys ??= (async () => {
    const generated = webpush.generateVAPIDKeys()
    await db
      .insert(siteSettings)
      .values({
        key: pushKeysKey,
        value: { publicKey: generated.publicKey, privateKey: encryptSecret('podnoms push key', generated.privateKey) },
      })
      .onConflictDoNothing()
    const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, pushKeysKey))
    const stored = storedKeys.parse(row!.value)
    return { publicKey: stored.publicKey, privateKey: decryptSecret('podnoms push key', stored.privateKey) }
  })()
  keys.catch(() => {
    keys = undefined
  })
  return keys
}

// For tests: forgets the keys, as after a restart.
export function resetPushKeys() {
  keys = undefined
}

export async function pushPublicKey() {
  return (await getPushKeys()).publicKey
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } }

// Saves this browser's subscription for the user. A browser has one
// subscription for the site, so whoever turned it on last gets its
// notifications.
export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput, userAgent: string | null) {
  const { client, os } = describeUserAgent(userAgent)
  const label = `${client ?? 'A browser'}${os ? ` on ${os}` : ''}`
  const values = { userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, label }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: subscription.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { ...values, createdAt: new Date() } })
}

// Turns notifications off for one of the user's browsers, by its id or its
// endpoint (the browser that's asking).
export async function deletePushSubscription(userId: string, which: { id: string } | { endpoint: string }) {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        'id' in which ? eq(pushSubscriptions.id, which.id) : eq(pushSubscriptions.endpoint, which.endpoint),
      ),
    )
}

// Everything on the settings page's desktop notifications card.
export async function getPushSettings(userId: string) {
  const [[prefs], devices, follows] = await Promise.all([
    db.select({ pushLive: users.pushLive, pushNewEpisodes: users.pushNewEpisodes }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        label: pushSubscriptions.label,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt)),
    db
      .select({
        podcastId: podcasts.id,
        title: podcasts.title,
        slug: podcasts.slug,
        imageUrl: podcasts.imageUrl,
        notify: podcastFollows.notify,
      })
      .from(podcastFollows)
      .innerJoin(podcasts, eq(podcasts.id, podcastFollows.podcastId))
      // As for following: public podcasts, and the user's own.
      .where(and(eq(podcastFollows.userId, userId), or(eq(podcasts.private, false), eq(podcasts.userId, userId))))
      .orderBy(podcasts.title),
  ])
  if (!prefs) return null
  return { ...prefs, devices, follows, publicKey: await pushPublicKey() }
}

export async function updatePushPrefs(userId: string, prefs: { pushLive: boolean; pushNewEpisodes: boolean }) {
  await db.update(users).set(prefs).where(eq(users.id, userId))
}

// Mutes or unmutes a podcast the user follows. Returns whether they follow it.
export async function setFollowNotify(userId: string, podcastId: string, notify: boolean) {
  const updated = await db
    .update(podcastFollows)
    .set({ notify })
    .where(and(eq(podcastFollows.userId, userId), eq(podcastFollows.podcastId, podcastId)))
    .returning({ podcastId: podcastFollows.podcastId })
  return updated.length > 0
}

// The followers who want this kind of notification about the podcast: not its
// owner, nor anyone who has muted it.
async function recipients(podcastId: string, ownerId: string, pref: PushPref) {
  const rows = await db
    .select({ userId: podcastFollows.userId })
    .from(podcastFollows)
    .innerJoin(users, eq(users.id, podcastFollows.userId))
    .where(
      and(
        eq(podcastFollows.podcastId, podcastId),
        eq(podcastFollows.notify, true),
        eq(users[pref], true),
        ne(podcastFollows.userId, ownerId),
      ),
    )
  return rows.map((row) => row.userId)
}

// Push services want a way to reach whoever sends: the site's address, or the
// project's when SITE_URL isn't set.
const contact = () => siteOrigin() ?? 'https://github.com/podnoms/podnoms-platform'

// Sends the message to every browser the users have turned notifications on
// in, dropping those the push service says have gone.
export async function sendPush(userIds: string[], message: PushMessage) {
  if (!userIds.length) return
  const subscriptions = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds))
  if (!subscriptions.length) return
  const { publicKey, privateKey } = await getPushKeys()
  const payload = JSON.stringify(message)
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          payload,
          // Kept for a day by the push service if the browser is offline.
          { vapidDetails: { subject: contact(), publicKey, privateKey }, TTL: 24 * 60 * 60, timeout: 15_000 },
        )
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id))
          return
        }
        logger.warn({ err: error, subscriptionId: subscription.id }, 'Push notification not sent')
      }
    }),
  )
}

// Notifications never get in the way of what they're about.
const safely = (work: Promise<void>) =>
  void work.catch((error: unknown) => reportError(error, { msg: 'Sending a push notification failed' }))

export function notifyFollowersLive(podcastId: string, broadcastTitle: string) {
  safely(
    (async () => {
      const [podcast] = await db.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1)
      if (!podcast || podcast.private) return
      await sendPush(await recipients(podcastId, podcast.userId, 'pushLive'), {
        title: `${podcast.title} is live`,
        body: broadcastTitle,
        url: livePath(podcast.slug),
        icon: podcast.imageUrl,
        tag: `live-${podcastId}`,
      })
    })(),
  )
}

const waiting = new Map<string, Set<string>>()

// For an episode that has just become ready: tells its podcast's followers,
// with any others from the podcast in the next couple of minutes.
export function notifyFollowersNewEpisode(episodeId: string, podcastId: string, publishedAt: Date | null, now = new Date()) {
  if (publishedAt && now.getTime() - publishedAt.getTime() > newEpisodeMaxAgeMs) return
  const batch = waiting.get(podcastId)
  if (batch) {
    batch.add(episodeId)
    return
  }
  waiting.set(podcastId, new Set([episodeId]))
  setTimeout(() => safely(flushEpisodes(podcastId)), episodeBatchDelayMs).unref?.()
}

async function flushEpisodes(podcastId: string) {
  const ids = waiting.get(podcastId)
  waiting.delete(podcastId)
  if (!ids?.size) return
  const [podcast] = await db.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1)
  if (!podcast || podcast.private) return
  // As they are now: any made private or deleted meanwhile are left out.
  const ready = await db
    .select({ title: episodes.title, slug: episodes.slug, imageUrl: episodes.imageUrl })
    .from(episodes)
    .where(and(inArray(episodes.id, [...ids]), isListed))
  if (!ready.length) return
  const [first] = ready
  await sendPush(
    await recipients(podcastId, podcast.userId, 'pushNewEpisodes'),
    ready.length === 1
      ? {
          title: `New from ${podcast.title}`,
          body: first!.title,
          url: episodePath(podcast.slug, first!.slug),
          icon: first!.imageUrl ?? podcast.imageUrl,
          tag: `episodes-${podcastId}`,
        }
      : {
          title: `${ready.length} new episodes from ${podcast.title}`,
          body: ready.map((episode) => episode.title).join(' · '),
          url: podcastPath(podcast.slug),
          icon: podcast.imageUrl,
          tag: `episodes-${podcastId}`,
        },
  )
}

// For tests: sends every waiting batch now.
export async function flushAllPushes() {
  await Promise.all([...waiting.keys()].map(flushEpisodes))
}
