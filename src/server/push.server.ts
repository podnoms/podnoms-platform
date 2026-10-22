// Desktop notifications (Web Push), which tell listeners about the podcasts
// they follow (see follower-notifications.server.ts). Each browser a user
// turns them on in (on /settings/notifications) has a push_subscription, and
// the service worker (public/push-sw.js) shows what's sent.
//
// The site's VAPID keys, which push services know it by, are made on first
// use and kept as the app's own "__pushKeys" in site_settings, the private
// key encrypted. Changing AUTH_SECRET makes new ones, after which browsers
// have to turn notifications on again.
import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import webpush, { WebPushError } from 'web-push'
import { z } from 'zod'
import { db } from '~/server/db/client.server'
import { pushSubscriptions, siteSettings, users } from '~/server/db/schema'
import { logger } from '~/server/logger.server'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'
import { internalKeyPrefix } from '~/server/site-settings.server'
import { siteOrigin } from '~/server/site-url.server'
import { describeUserAgent } from '~/server/user-agent.server'

export const pushKeysKey = `${internalKeyPrefix}pushKeys`
const storedKeys = z.object({ publicKey: z.string(), privateKey: z.string() })

// What the service worker shows. `url` is opened when it's clicked; a newer
// notification with the same `tag` replaces an older one.
export type PushMessage = { title: string; body: string; url: string; icon: string | null; tag: string }

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
  const [[prefs], devices] = await Promise.all([
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
  ])
  if (!prefs) return null
  return { ...prefs, devices, publicKey: await pushPublicKey() }
}

export async function updatePushPrefs(userId: string, prefs: { pushLive: boolean; pushNewEpisodes: boolean }) {
  await db.update(users).set(prefs).where(eq(users.id, userId))
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
