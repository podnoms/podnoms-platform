// Activity recorded through the routes: downloads by the audio endpoint, and
// plays and shares reported by browsers.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as ActivityRoute } from '~/routes/api/episodes/$id/activity'
import { Route as AudioRoute } from '~/routes/api/episodes/$id/audio'
import { episodeActivity } from '~/server/db/schema'
import { episodeAudioPath } from '~/server/storage.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createPodcast, createUser, db } from '../helpers'

vi.mock('~/server/geoip.server', () => ({ lookupLocation: vi.fn(async () => null) }))

const overcast = 'Overcast/3.0 (+http://overcast.fm/; iOS podcast app)'
const chrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

beforeEach(() => resetDb(db))

async function readyEpisode() {
  const podcast = await createPodcast((await createUser()).id)
  const episode = await createEpisode(podcast.id, { status: 'ready', audioUrl: '/api/episodes/x/audio' })
  await mkdir(dirname(episodeAudioPath(episode.id)), { recursive: true })
  // Bigger than the probes apps make before downloading.
  await writeFile(episodeAudioPath(episode.id), new Uint8Array(10_000))
  return episode
}

const activity = () => db.select().from(episodeActivity)

describe('downloads', () => {
  const get = async (id: string, headers: Record<string, string>) => {
    const response = await callRoute(AudioRoute, 'GET', new Request(`http://x/api/episodes/${id}/audio`, { headers }), { id })
    await response.arrayBuffer()
    return response
  }

  it('counts a podcast app fetching the audio, once a day', async () => {
    const episode = await readyEpisode()
    await get(episode.id, { 'user-agent': overcast, 'x-forwarded-for': '203.0.113.7' })
    await get(episode.id, { 'user-agent': overcast, 'x-forwarded-for': '203.0.113.7', range: 'bytes=5000-' })
    await vi.waitFor(async () => expect(await activity()).toHaveLength(1))
    expect((await activity())[0]).toMatchObject({ type: 'download', source: 'app', client: 'Overcast' })
  })

  it("doesn't count the site's own players, which report plays themselves", async () => {
    const episode = await readyEpisode()
    await get(episode.id, { 'user-agent': chrome, 'sec-fetch-dest': 'audio' })
    // A download link, by contrast, is a download.
    await get(episode.id, { 'user-agent': chrome, 'sec-fetch-dest': 'document' })
    await vi.waitFor(async () => expect(await activity()).toHaveLength(1))
  })

  it("doesn't count probes for the first few bytes", async () => {
    const episode = await readyEpisode()
    await get(episode.id, { 'user-agent': overcast, range: 'bytes=0-1' })
    // Recording is in the background; give it a moment to (not) happen.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await activity()).toHaveLength(0)
  })
})

describe('POST /api/episodes/:id/activity', () => {
  const post = (id: string, body: unknown) =>
    callRoute(
      ActivityRoute,
      'POST',
      new Request(`http://x/api/episodes/${id}/activity`, {
        method: 'POST',
        headers: { 'user-agent': chrome, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { id },
    )

  it('records a play or a share', async () => {
    const episode = await readyEpisode()
    expect((await post(episode.id, { type: 'play', source: 'listen', referrer: 'https://t.co/abc' })).status).toBe(204)
    expect((await post(episode.id, { type: 'share', source: 'web', detail: 'embed' })).status).toBe(204)
    expect(await activity()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'play', source: 'listen', referrerHost: 't.co' }),
        expect.objectContaining({ type: 'share', source: 'web', detail: 'embed' }),
      ]),
    )
  })

  it("answers the same whether or not it's counted", async () => {
    const episode = await readyEpisode()
    expect((await post(episode.id, { type: 'play', source: 'web' })).status).toBe(204)
    expect((await post(episode.id, { type: 'play', source: 'web' })).status).toBe(204)
    expect((await post('missing', { type: 'play', source: 'web' })).status).toBe(204)
    expect(await activity()).toHaveLength(1)
  })

  it('refuses anything else, downloads included', async () => {
    const episode = await readyEpisode()
    expect((await post(episode.id, { type: 'download', source: 'app' })).status).toBe(400)
    expect((await post(episode.id, { type: 'share', source: 'web' })).status).toBe(400)
    expect((await post(episode.id, 'nonsense')).status).toBe(400)
  })
})
