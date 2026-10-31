// Notifications on the mobile app, which tell listeners about the shows they
// follow (see follower-notifications.server.ts). Each device that allows them
// sends us its Expo push token (mobile_token.pushToken), and they go through
// Expo's push service, which passes them to FCM or APNs. The app opens `path`
// when one's pressed. Its title and body pass through Expo, so nothing goes
// this way about private shows.
import '@tanstack/react-start/server-only'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { mobileTokens, users } from '~/server/db/schema'
import { logger } from '~/server/logger.server'

// Which of the app's Android notification channels it goes in (its lib/notifications.ts).
export type AppPushMessage = { title: string; body: string; path: string; channel: 'live' | 'episodes' }

const sendUrl = 'https://exp.host/--/api/v2/push/send'
const receiptsUrl = 'https://exp.host/--/api/v2/push/getReceipts'
// The most Expo takes in one request.
const chunkSize = 100
// How long after sending Expo suggests checking what became of them.
export const receiptDelayMs = 15 * 60_000

type Outcome = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }

const forgetToken = (pushToken: string) =>
  db.update(mobileTokens).set({ pushToken: null }).where(eq(mobileTokens.pushToken, pushToken))

// A device that's gone (uninstalled, or notifications turned off) stops being
// sent to until it tells us its token again. Anything else is only worth a note.
async function handleOutcome(outcome: Outcome, pushToken: string) {
  if (outcome.status !== 'error') return
  if (outcome.details?.error === 'DeviceNotRegistered') await forgetToken(pushToken)
  else logger.warn({ error: outcome.details?.error, message: outcome.message }, 'App notification not sent')
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Expo said ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

// What became of notifications Expo accepted. It may be told later that a
// device has gone, so this is where most of them are found out. In memory,
// like the batches of new episodes: a restart only misses a tidy-up.
export async function checkReceipts(tokensByTicket: Map<string, string>) {
  const ids = [...tokensByTicket.keys()]
  for (let start = 0; start < ids.length; start += chunkSize) {
    const { data = {} } = await postJson<{ data?: Record<string, Outcome> }>(receiptsUrl, { ids: ids.slice(start, start + chunkSize) })
    for (const [id, receipt] of Object.entries(data)) await handleOutcome(receipt, tokensByTicket.get(id)!)
  }
}

// Sends the message to every device of these users that has allowed notifications.
export async function sendAppPush(userIds: string[], { title, body, path, channel }: AppPushMessage) {
  if (!userIds.length) return
  const rows = await db
    .select({ pushToken: mobileTokens.pushToken })
    .from(mobileTokens)
    .where(and(inArray(mobileTokens.userId, userIds), isNotNull(mobileTokens.pushToken)))
  const tokens = rows.map((row) => row.pushToken!)
  const tokensByTicket = new Map<string, string>()
  for (let start = 0; start < tokens.length; start += chunkSize) {
    const chunk = tokens.slice(start, start + chunkSize)
    const { data } = await postJson<{ data: Outcome[] }>(
      sendUrl,
      chunk.map((to) => ({
        to,
        title,
        body,
        data: { path },
        channelId: channel,
        sound: 'default',
        priority: channel === 'live' ? 'high' : 'normal',
        // Kept for a day if the device is offline, as desktop notifications are.
        ttl: 24 * 60 * 60,
      })),
    )
    await Promise.all(
      data.map((ticket, index) => {
        if (ticket.id) tokensByTicket.set(ticket.id, chunk[index]!)
        return handleOutcome(ticket, chunk[index]!)
      }),
    )
  }
  if (tokensByTicket.size > 0) {
    setTimeout(
      () =>
        void checkReceipts(tokensByTicket).catch((error: unknown) =>
          logger.warn({ err: error }, 'Could not check app notification receipts'),
        ),
      receiptDelayMs,
    ).unref?.()
  }
}

// Which notifications the user gets on the app about the shows they follow.
export async function getAppPushPrefs(userId: string) {
  const [prefs] = await db
    .select({ live: users.appPushLive, newEpisodes: users.appPushNewEpisodes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return prefs ?? null
}

export async function updateAppPushPrefs(userId: string, prefs: { live: boolean; newEpisodes: boolean }) {
  await db.update(users).set({ appPushLive: prefs.live, appPushNewEpisodes: prefs.newEpisodes }).where(eq(users.id, userId))
}
