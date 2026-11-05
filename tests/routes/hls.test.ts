// An episode's HLS stream: the entry playlist, which follows the audio
// endpoint's rules, and the files under each version.
import { mkdir, writeFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as HlsRoute } from '~/routes/api/episodes/$id/hls/$'
import { getSession } from '~/server/auth.server'
import { episodes } from '~/server/db/schema'
import { hlsSignature } from '~/server/hls.server'
import { episodeHlsVersionDir } from '~/server/storage.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createShow, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
})

const get = (id: string, path: string, headers: Record<string, string> = {}) =>
  callRoute(HlsRoute, 'GET', new Request(`http://x/api/episodes/${id}/hls/${path}`, { headers }), { id, _splat: path.split('?')[0]! })

// A ready episode with a built stream at version v1.
async function streamedEpisode({ showPrivate = false, episodePrivate = false, built = true } = {}) {
  const owner = await createUser()
  const show = await createShow(owner.id, { private: showPrivate, feedKey: showPrivate ? 'k3y' : null })
  const episode = await createEpisode(show.id, {
    status: 'ready',
    audioUrl: 'x',
    private: episodePrivate,
    hlsVersion: built ? 'v1' : null,
  })
  const dir = episodeHlsVersionDir(episode.id, 'v1')
  await mkdir(`${dir}/96k`, { recursive: true })
  await writeFile(`${dir}/master.m3u8`, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=99410\n96k/index.m3u8\n')
  await writeFile(`${dir}/96k/index.m3u8`, '#EXTM3U\n#EXT-X-MAP:URI="init_0.mp4"\n#EXTINF:6,\nseg-00000.m4s\n#EXT-X-ENDLIST\n')
  await writeFile(`${dir}/96k/seg-00000.m4s`, 'segment')
  return Object.assign(episode, { ownerId: owner.id })
}

describe('GET /api/episodes/:id/hls/master.m3u8', () => {
  it("gives a public episode's entry playlist to anyone, to be revalidated", async () => {
    const episode = await streamedEpisode()
    const response = await get(episode.id, 'master.m3u8')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    expect(response.headers.get('cache-control')).toBe('public, no-cache')
    expect(await response.text()).toContain(`/api/episodes/${episode.id}/hls/v1/96k/index.m3u8`)
  })

  it("is a 404 until the stream is built", async () => {
    const episode = await streamedEpisode({ built: false })
    expect((await get(episode.id, 'master.m3u8')).status).toBe(404)
  })

  it("gives a private episode's only to its owner, signed and uncached", async () => {
    const episode = await streamedEpisode({ episodePrivate: true })
    expect((await get(episode.id, 'master.m3u8')).status).toBe(404)
    vi.mocked(getSession).mockResolvedValue({ user: { id: episode.ownerId }, expires: '' })
    const response = await get(episode.id, 'master.m3u8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toMatch(new RegExp(`/hls/v1/s/[\\w.-]+/96k/index\\.m3u8`))
  })
})

describe('GET /api/episodes/:id/hls/<version>/<file>', () => {
  it("serves a public episode's files, cacheable by anyone for a day and by browsers for good", async () => {
    const episode = await streamedEpisode()
    const response = await get(episode.id, 'v1/96k/seg-00000.m4s')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mp4')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable, s-maxage=86400')
    expect(response.headers.get('content-length')).toBe('7')
    expect(await response.text()).toBe('segment')
    const playlist = await get(episode.id, 'v1/96k/index.m3u8')
    expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
  })

  it('answers a matching ETag with 304', async () => {
    const episode = await streamedEpisode()
    const etag = (await get(episode.id, 'v1/96k/seg-00000.m4s')).headers.get('etag')!
    const response = await get(episode.id, 'v1/96k/seg-00000.m4s', { 'if-none-match': etag })
    expect(response.status).toBe(304)
  })

  it("serves a private episode's files only under a valid signature, privately", async () => {
    const episode = await streamedEpisode({ episodePrivate: true })
    expect((await get(episode.id, 'v1/96k/seg-00000.m4s')).status).toBe(404)
    expect((await get(episode.id, 'v1/s/1.forged/96k/seg-00000.m4s')).status).toBe(404)
    const response = await get(episode.id, `v1/s/${hlsSignature(episode.id, 'v1')}/96k/seg-00000.m4s`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
  })

  it('stops serving the unsigned path as soon as the episode leaves public view', async () => {
    const episode = await streamedEpisode()
    await db.update(episodes).set({ private: true }).where(eq(episodes.id, episode.id))
    expect((await get(episode.id, 'v1/96k/seg-00000.m4s')).status).toBe(404)
  })

  it('refuses paths outside the stream', async () => {
    const episode = await streamedEpisode()
    for (const path of ['v1/../../audio/x.mp3', 'v1/master.m3u8', 'v1', '../x/96k/seg-00000.m4s']) {
      expect((await get(episode.id, path)).status).toBe(404)
    }
  })
})
