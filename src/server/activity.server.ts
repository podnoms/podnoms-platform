// What listeners do with episodes (plays, downloads, shares), for podcast
// owners' stats. Kept unidentifiable on purpose:
// - The IP address is used to look up the country, region and city, and to
//   tell visitors apart, then dropped. Visitors are told apart by a hash of
//   the address and user agent with a random salt that changes daily and is
//   deleted once the day is over, so hashes can't be traced back to an
//   address, or linked from one day to the next.
// - Each visitor counts once a day for each episode and kind of activity, as
//   podcast apps fetch the same audio in many pieces.
// - Crawlers aren't counted, nor are signed-in users' accounts recorded.
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { getRequestIP } from '@tanstack/react-start/server'
import { and, count, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '~/server/db/client.server'
import { episodeActivity, episodes, visitorSalts, type ActivitySource, type ActivityType } from '~/server/db/schema'
import { lookupLocation } from '~/server/geoip.server'
import { describeUserAgent, isBot } from '~/server/user-agent.server'

export type ActivityInput = {
  episodeId: string
  type: ActivityType
  source: ActivitySource
  // For a share, what was shared.
  detail?: 'link' | 'embed'
  // The page that led here, when the browser reports it rather than sending
  // a Referer header (as for plays, where the header names our own page).
  referrer?: string | null
}

// Records the activity, unless it's from a crawler, the episode isn't
// published, or this visitor has already done it today. Resolves to whether
// it was recorded.
export async function recordActivity(request: Request, input: ActivityInput) {
  const userAgent = request.headers.get('user-agent')
  if (isBot(userAgent)) return false
  const [episode] = await db
    .select({ podcastId: episodes.podcastId })
    .from(episodes)
    .where(and(eq(episodes.id, input.episodeId), eq(episodes.status, 'ready'), isNotNull(episodes.audioUrl)))
    .limit(1)
  if (!episode) return false

  const ip = clientIp(request)
  const [salt, location] = await Promise.all([saltFor(today()), lookupLocation(ip)])
  const rows = await db
    .insert(episodeActivity)
    .values({
      episodeId: input.episodeId,
      podcastId: episode.podcastId,
      type: input.type,
      source: input.source,
      detail: input.detail ?? null,
      visitorHash: visitorHash(salt, ip, userAgent),
      country: location?.country ?? null,
      region: location?.region ?? null,
      city: location?.city ?? null,
      ...describeUserAgent(userAgent),
      // Long enough for any real user agent; anything longer is junk.
      userAgent: userAgent?.slice(0, 512) ?? null,
      referrerHost: referrerHost(input.referrer ?? request.headers.get('referer'), request),
    })
    .onConflictDoNothing()
    .returning({ id: episodeActivity.id })
  return rows.length > 0
}

// The listener's address: from the reverse proxy in front of the app if
// there is one (the first, client-most address it forwarded), else the
// connection's. Spoofing it only misplaces your own listens.
export function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  try {
    return getRequestIP() ?? null
  } catch {
    // Outside a request handled by the server (as in tests).
    return null
  }
}

export function visitorHash(salt: string, ip: string | null, userAgent: string | null) {
  return createHash('sha256')
    .update(`${salt}\n${ip ?? ''}\n${userAgent ?? ''}`)
    .digest('base64url')
    .slice(0, 22)
}

// The day, in UTC, as YYYY-MM-DD.
const today = () => new Date().toISOString().slice(0, 10)

// Kept in memory for the day, across dev server reloads.
const cache = globalThis as { podnomsVisitorSalt?: { day: string; salt: Promise<string> } }

// The day's salt, made on first use; making it deletes earlier days'.
export function saltFor(day: string) {
  if (cache.podnomsVisitorSalt?.day !== day) {
    const salt = (async () => {
      await db.delete(visitorSalts).where(lt(visitorSalts.day, day))
      await db
        .insert(visitorSalts)
        .values({ day, salt: randomBytes(32).toString('base64url') })
        .onConflictDoNothing()
      // Another request (or server) may have made it first.
      const [row] = await db.select({ salt: visitorSalts.salt }).from(visitorSalts).where(eq(visitorSalts.day, day))
      return row!.salt
    })()
    cache.podnomsVisitorSalt = { day, salt }
    salt.catch(() => {
      if (cache.podnomsVisitorSalt?.salt === salt) cache.podnomsVisitorSalt = undefined
    })
  }
  return cache.podnomsVisitorSalt!.salt
}

// The referring site's host, without "www."; null when there isn't one or
// it's this site.
function referrerHost(referrer: string | null, request: Request) {
  if (!referrer) return null
  try {
    const { hostname, protocol } = new URL(referrer)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    if (hostname === new URL(request.url).hostname) return null
    return hostname.replace(/^www\./, '').slice(0, 253)
  } catch {
    return null
  }
}

export type ActivitySummary = Awaited<ReturnType<typeof summariseActivity>>

// A podcast's activity (or one episode's) over the last `days` days: totals
// by kind, a count per day, and the top countries, apps and referring sites.
export async function summariseActivity({
  podcastId,
  episodeId,
  days,
  now = new Date(),
}: {
  podcastId: string
  episodeId?: string
  days: number
  now?: Date
}) {
  // Whole UTC days, ending today.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const start = new Date(end.getTime() - days * 86_400_000)
  const where = and(
    eq(episodeActivity.podcastId, podcastId),
    episodeId ? eq(episodeActivity.episodeId, episodeId) : undefined,
    gte(episodeActivity.occurredAt, start),
    lt(episodeActivity.occurredAt, end),
  )

  const day = sql<string>`to_char(${episodeActivity.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`
  const [byType, byDay, countries, clients, referrers] = await Promise.all([
    db.select({ type: episodeActivity.type, count: count() }).from(episodeActivity).where(where).groupBy(episodeActivity.type),
    db
      .select({ day, type: episodeActivity.type, count: count() })
      .from(episodeActivity)
      .where(where)
      .groupBy(day, episodeActivity.type),
    top(episodeActivity.country, where),
    top(episodeActivity.client, where),
    top(episodeActivity.referrerHost, where),
  ])

  const totals = { play: 0, download: 0, share: 0 }
  for (const row of byType) totals[row.type] = row.count
  const daily = Array.from({ length: days }, (_, i) => ({
    day: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    play: 0,
    download: 0,
    share: 0,
  }))
  const dayIndex = new Map(daily.map((entry, i) => [entry.day, i]))
  for (const row of byDay) {
    const i = dayIndex.get(row.day)
    if (i !== undefined) daily[i]![row.type] = row.count
  }
  return { totals, daily, countries, clients, referrers }
}

// The most common values of a column (leaving out unknowns), with counts.
function top(column: AnyPgColumn, where: SQL | undefined, limit = 5) {
  return db
    .select({ value: sql<string>`${column}`, count: count() })
    .from(episodeActivity)
    .where(and(where, isNotNull(column)))
    .groupBy(column)
    .orderBy(desc(count()), column)
    .limit(limit)
}
