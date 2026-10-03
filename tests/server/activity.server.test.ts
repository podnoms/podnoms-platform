import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clientIp, recordActivity, saltFor, summariseActivity, visitorHash } from '~/server/activity.server'
import { episodeActivity, visitorSalts } from '~/server/db/schema'
import { lookupLocation } from '~/server/geoip.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

// Locations are tested in geoip.server.test.ts.
vi.mock('~/server/geoip.server', () => ({ lookupLocation: vi.fn(async () => null) }))

const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
const overcast = 'Overcast/3.0 (+http://overcast.fm/; iOS podcast app)'

beforeEach(async () => {
  await resetDb(db)
  delete (globalThis as { podnomsVisitorSalt?: unknown }).podnomsVisitorSalt
  vi.mocked(lookupLocation).mockResolvedValue(null)
})

async function publishedEpisode() {
  const podcast = await createPodcast((await createUser()).id)
  const episode = await createEpisode(podcast.id, { status: 'ready', audioUrl: '/api/episodes/x/audio', durationSeconds: 60 })
  return { podcast, episode }
}

function request(headers: Record<string, string> = {}) {
  return new Request('https://podnoms.test/api/episodes/x/activity', {
    method: 'POST',
    headers: { 'user-agent': firefox, 'x-forwarded-for': '203.0.113.7', ...headers },
  })
}

describe('recordActivity', () => {
  it('records where it came from, without the IP address', async () => {
    const { podcast, episode } = await publishedEpisode()
    vi.mocked(lookupLocation).mockResolvedValue({ country: 'IE', region: 'L', city: 'Dublin' })
    expect(
      await recordActivity(request({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), {
        episodeId: episode.id,
        type: 'play',
        source: 'embed',
        referrer: 'https://www.example.com/blog/post',
      }),
    ).toBe(true)

    expect(lookupLocation).toHaveBeenCalledWith('203.0.113.7')
    const [row] = await db.select().from(episodeActivity)
    expect(row).toMatchObject({
      episodeId: episode.id,
      podcastId: podcast.id,
      type: 'play',
      source: 'embed',
      country: 'IE',
      region: 'L',
      city: 'Dublin',
      client: 'Firefox',
      os: 'Windows',
      device: 'desktop',
      userAgent: firefox,
      referrerHost: 'example.com',
    })
    expect(JSON.stringify(row)).not.toContain('203.0.113.7')
  })

  it('counts each visitor once a day for each episode and kind of activity', async () => {
    const { episode } = await publishedEpisode()
    const play = { episodeId: episode.id, type: 'play', source: 'web' } as const
    expect(await recordActivity(request(), play)).toBe(true)
    expect(await recordActivity(request(), play)).toBe(false)
    expect(await recordActivity(request(), { ...play, type: 'download', source: 'app' })).toBe(true)
    // Another address, or another app at the same address, is another visitor.
    expect(await recordActivity(request({ 'x-forwarded-for': '198.51.100.1' }), play)).toBe(true)
    expect(await recordActivity(request({ 'user-agent': overcast }), play)).toBe(true)
    expect(await db.$count(episodeActivity)).toBe(4)
  })

  it("doesn't count crawlers", async () => {
    const { episode } = await publishedEpisode()
    const bot = request({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })
    expect(await recordActivity(bot, { episodeId: episode.id, type: 'download', source: 'app' })).toBe(false)
    expect(await db.$count(episodeActivity)).toBe(0)
  })

  it("doesn't count episodes that aren't published", async () => {
    const podcast = await createPodcast((await createUser()).id)
    const pending = await createEpisode(podcast.id, { status: 'processing' })
    expect(await recordActivity(request(), { episodeId: pending.id, type: 'play', source: 'web' })).toBe(false)
    expect(await recordActivity(request(), { episodeId: 'nope', type: 'play', source: 'web' })).toBe(false)
  })

  it('takes the referrer from the header unless one is given, ignoring this site', async () => {
    const { episode } = await publishedEpisode()
    const referred = async (headers: Record<string, string>, referrer?: string) => {
      await resetDb(db)
      const { episode } = await publishedEpisode()
      await recordActivity(request(headers), { episodeId: episode.id, type: 'download', source: 'app', referrer })
      return (await db.select().from(episodeActivity))[0]?.referrerHost
    }
    expect(episode).toBeTruthy()
    expect(await referred({ referer: 'https://news.example.org/a' })).toBe('news.example.org')
    expect(await referred({ referer: 'https://podnoms.test/podcasts/show' })).toBeNull()
    expect(await referred({ referer: 'https://podnoms.test/' }, 'https://social.example/')).toBe('social.example')
    expect(await referred({}, 'not a url')).toBeNull()
    expect(await referred({}, 'android-app://com.example')).toBeNull()
  })
})

describe('visitor salts', () => {
  it('makes one salt a day and deletes earlier days', async () => {
    const first = await saltFor('2026-10-01')
    expect(await saltFor('2026-10-01')).toBe(first)
    delete (globalThis as { podnomsVisitorSalt?: unknown }).podnomsVisitorSalt
    // Another server process gets the same salt.
    expect(await saltFor('2026-10-01')).toBe(first)

    const next = await saltFor('2026-10-02')
    expect(next).not.toBe(first)
    expect(await db.select({ day: visitorSalts.day }).from(visitorSalts)).toEqual([{ day: '2026-10-02' }])
  })

  it('hashes the same visitor differently with a different salt', () => {
    expect(visitorHash('a', '203.0.113.7', firefox)).toBe(visitorHash('a', '203.0.113.7', firefox))
    expect(visitorHash('a', '203.0.113.7', firefox)).not.toBe(visitorHash('b', '203.0.113.7', firefox))
    expect(visitorHash('a', '203.0.113.7', firefox)).not.toBe(visitorHash('a', '203.0.113.8', firefox))
  })
})

describe('clientIp', () => {
  it('takes the client-most forwarded address, then X-Real-IP', () => {
    const ip = (headers: Record<string, string>) => clientIp(new Request('http://x/', { headers }))
    expect(ip({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7')
    expect(ip({ 'x-real-ip': '198.51.100.1' })).toBe('198.51.100.1')
    expect(ip({})).toBeNull()
  })
})

describe('summariseActivity', () => {
  const now = new Date('2026-10-03T12:00:00Z')

  async function insert(rows: Partial<typeof episodeActivity.$inferInsert>[], episodeId: string, podcastId: string) {
    await db.insert(episodeActivity).values(
      rows.map((row, i) => ({
        episodeId,
        podcastId,
        type: 'play' as const,
        source: 'web' as const,
        visitorHash: `v${i}`,
        occurredAt: now,
        ...row,
      })),
    )
  }

  it('totals, counts by day and lists the top countries, apps and referrers', async () => {
    const { podcast, episode } = await publishedEpisode()
    await insert(
      [
        { country: 'IE', client: 'Overcast' },
        { country: 'IE', client: 'Overcast', type: 'download', source: 'app' },
        { country: 'GB', client: 'Firefox', referrerHost: 'example.com', occurredAt: new Date('2026-10-02T23:00:00Z') },
        { type: 'share', detail: 'link' },
        // Too long ago.
        { country: 'FR', occurredAt: new Date('2026-09-01T00:00:00Z') },
      ],
      episode.id,
      podcast.id,
    )

    const summary = await summariseActivity({ podcastId: podcast.id, days: 7, now })
    expect(summary.totals).toEqual({ play: 2, download: 1, share: 1 })
    expect(summary.daily).toHaveLength(7)
    expect(summary.daily.at(0)?.day).toBe('2026-09-27')
    expect(summary.daily.at(-1)).toEqual({ day: '2026-10-03', play: 1, download: 1, share: 1 })
    expect(summary.daily.at(-2)).toEqual({ day: '2026-10-02', play: 1, download: 0, share: 0 })
    expect(summary.countries).toEqual([
      { value: 'IE', count: 2 },
      { value: 'GB', count: 1 },
    ])
    expect(summary.clients).toEqual([
      { value: 'Overcast', count: 2 },
      { value: 'Firefox', count: 1 },
    ])
    expect(summary.referrers).toEqual([{ value: 'example.com', count: 1 }])
  })

  it('covers just one episode when asked', async () => {
    const { podcast, episode } = await publishedEpisode()
    const other = await createEpisode(podcast.id, { status: 'ready', audioUrl: '/a' })
    await insert([{}, {}], episode.id, podcast.id)
    await insert([{ visitorHash: 'other' }], other.id, podcast.id)
    const summary = await summariseActivity({ podcastId: podcast.id, episodeId: other.id, days: 7, now })
    expect(summary.totals.play).toBe(1)
  })

  it('is all zeros with no activity', async () => {
    const { podcast } = await publishedEpisode()
    const summary = await summariseActivity({ podcastId: podcast.id, days: 30, now })
    expect(summary.totals).toEqual({ play: 0, download: 0, share: 0 })
    expect(summary.daily).toHaveLength(30)
    expect(summary.countries).toEqual([])
  })
})
