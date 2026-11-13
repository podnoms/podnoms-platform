import { readdir, readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodes } from '~/server/db/schema'
import {
  buildHls,
  entryPlaylist,
  hlsBuildsSettled,
  hlsFilePath,
  hlsSignature,
  hlsSignatureLifetimeMs,
  moveHlsVersions,
  queueHlsBuild,
  verifyHlsSignature,
} from '~/server/hls.server'
import { episodeAudioPath, episodeHlsDir, episodeHlsVersionDir, episodeMasterPath } from '~/server/storage.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db, exists, hasFfmpeg, makeTone } from '../helpers'

beforeEach(async () => {
  await resetDb(db)
})

async function readyEpisode({ showPrivate = false, episodePrivate = false } = {}) {
  const owner = await createUser()
  const show = await createShow(owner.id, { private: showPrivate, feedKey: showPrivate ? 'k3y' : null })
  return createEpisode(show.id, { status: 'ready', audioUrl: 'x', audioMimeType: 'audio/mpeg', private: episodePrivate })
}

const current = async (id: string) =>
  (await db.select().from(episodes).where(eq(episodes.id, id)).limit(1))[0]!

describe('signatures', () => {
  it('verifies its own signatures until they expire', () => {
    const now = Date.now()
    const signature = hlsSignature('episode', 'v1', now)
    expect(verifyHlsSignature('episode', 'v1', signature, now)).toBe(true)
    expect(verifyHlsSignature('episode', 'v1', signature, now + hlsSignatureLifetimeMs - 1000)).toBe(true)
    expect(verifyHlsSignature('episode', 'v1', signature, now + hlsSignatureLifetimeMs + 1000)).toBe(false)
  })

  it("rejects another episode's or version's signature, and forgeries", () => {
    const signature = hlsSignature('episode', 'v1')
    expect(verifyHlsSignature('other', 'v1', signature)).toBe(false)
    expect(verifyHlsSignature('episode', 'v2', signature)).toBe(false)
    const [expires] = signature.split('.')
    expect(verifyHlsSignature('episode', 'v1', `${Number(expires) + 99999}.${signature.split('.')[1]}`)).toBe(false)
    expect(verifyHlsSignature('episode', 'v1', 'nonsense')).toBe(false)
  })
})

describe.skipIf(!hasFfmpeg)('buildHls', () => {
  it('builds a stream from the master, records the master, and lists its bitrates', async () => {
    const episode = await readyEpisode()
    await makeTone(episodeMasterPath(episode.id), 8, ['-ac', '2', '-c:a', 'flac', '-f', 'matroska'])
    const version = await buildHls(episode.id)
    expect(version).toBeTruthy()
    const row = await current(episode.id)
    expect(row).toMatchObject({ hlsVersion: version, masterCodec: 'flac', masterChannels: 2 })
    // Lossless, so every bitrate.
    const dir = episodeHlsVersionDir(episode.id, version!)
    expect((await readdir(dir)).sort()).toEqual(['160k', '256k', '96k', 'master.m3u8'])
    const variant = await readFile(`${dir}/96k/index.m3u8`, 'utf8')
    expect(variant).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(variant).toMatch(/^seg-00000\.m4s$/m)
  })

  it('builds from the MP3 when there is no master, without bitrates above it', async () => {
    const episode = await readyEpisode()
    await makeTone(episodeAudioPath(episode.id), 4, ['-ac', '1', '-b:a', '32k'])
    const version = await buildHls(episode.id)
    // Mono at 32k: only the lowest (mono) bitrate.
    expect((await readdir(episodeHlsVersionDir(episode.id, version!))).sort()).toEqual(['48k', 'master.m3u8'])
    expect(await current(episode.id)).toMatchObject({ hlsVersion: version, masterCodec: null })
  })

  // ffmpeg names the init segment init_<n>.mp4 when there are several
  // bitrates but plain init.mp4 when there's one, and both must be served.
  it.each([
    ['one bitrate', ['-ac', '1', '-b:a', '32k']],
    ['several bitrates', ['-ac', '2', '-b:a', '320k']],
  ])('can serve every file its playlists name, with %s', async (_, toneArgs) => {
    const episode = await readyEpisode()
    await makeTone(episodeAudioPath(episode.id), 4, toneArgs)
    const version = await buildHls(episode.id)
    const dir = episodeHlsVersionDir(episode.id, version!)
    const bitrates = (await readdir(dir)).filter((name) => name !== 'master.m3u8')
    for (const bitrate of bitrates) {
      const playlist = await readFile(`${dir}/${bitrate}/index.m3u8`, 'utf8')
      const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1]
      expect(init).toBeTruthy()
      const segments = playlist.split('\n').filter((line) => line && !line.startsWith('#'))
      for (const file of [init!, ...segments]) {
        expect(await hlsFilePath(episode.id, version!, null, `${bitrate}/${file}`), `${bitrate}/${file}`).toBeTruthy()
      }
    }
  })

  it("does nothing for an episode that isn't ready", async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const episode = await createEpisode(show.id, { status: 'processing' })
    expect(await buildHls(episode.id)).toBeNull()
  })

  it('runs queued builds in the background', async () => {
    const episode = await readyEpisode()
    await makeTone(episodeAudioPath(episode.id), 2)
    queueHlsBuild(episode.id)
    queueHlsBuild(episode.id)
    await hlsBuildsSettled()
    expect((await current(episode.id)).hlsVersion).toBeTruthy()
  })
})

describe('entryPlaylist', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=99410\n96k/index.m3u8\n'

  async function withStream(options: Parameters<typeof readyEpisode>[0] = {}) {
    const episode = await readyEpisode(options)
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(episodeHlsVersionDir(episode.id, 'v1'), { recursive: true })
    await writeFile(`${episodeHlsVersionDir(episode.id, 'v1')}/master.m3u8`, master)
    await db.update(episodes).set({ hlsVersion: 'v1' }).where(eq(episodes.id, episode.id))
    return episode
  }

  it("points a public episode's players at its version's playlists", async () => {
    const episode = await withStream()
    const body = await entryPlaylist(episode.id, { hlsVersion: 'v1', public: true })
    expect(body).toContain(`\n/api/episodes/${episode.id}/hls/v1/96k/index.m3u8\n`)
    expect(body).toContain('#EXT-X-STREAM-INF:BANDWIDTH=99410')
  })

  it('signs the paths for episodes that are not public', async () => {
    const episode = await withStream({ episodePrivate: true })
    const body = await entryPlaylist(episode.id, { hlsVersion: 'v1', public: false })
    const signature = new RegExp(`/api/episodes/${episode.id}/hls/v1/s/([\\w.-]+)/96k/index\\.m3u8`).exec(body!)?.[1]
    expect(signature && verifyHlsSignature(episode.id, 'v1', signature)).toBe(true)
  })

  it('is null without a stream', async () => {
    const episode = await readyEpisode()
    expect(await entryPlaylist(episode.id, { hlsVersion: null, public: true })).toBeNull()
    // Its version's folder having gone counts too.
    expect(await entryPlaylist(episode.id, { hlsVersion: 'gone', public: true })).toBeNull()
  })
})

describe('hlsFilePath', () => {
  async function withFile(options: Parameters<typeof readyEpisode>[0] = {}) {
    const episode = await readyEpisode(options)
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(`${episodeHlsVersionDir(episode.id, 'v1')}/96k`, { recursive: true })
    await writeFile(`${episodeHlsVersionDir(episode.id, 'v1')}/96k/seg-00000.m4s`, 'segment')
    await db.update(episodes).set({ hlsVersion: 'v1' }).where(eq(episodes.id, episode.id))
    return episode
  }

  it("serves a public episode's current version to anyone", async () => {
    const episode = await withFile()
    expect(await hlsFilePath(episode.id, 'v1', null, '96k/seg-00000.m4s')).toBe(`${episodeHlsVersionDir(episode.id, 'v1')}/96k/seg-00000.m4s`)
    expect(await hlsFilePath(episode.id, 'v0', null, '96k/seg-00000.m4s')).toBeNull()
  })

  it('needs a valid signature for private episodes and private shows', async () => {
    for (const options of [{ episodePrivate: true }, { showPrivate: true }]) {
      const episode = await withFile(options)
      expect(await hlsFilePath(episode.id, 'v1', null, '96k/seg-00000.m4s')).toBeNull()
      expect(await hlsFilePath(episode.id, 'v1', 'bad.signature', '96k/seg-00000.m4s')).toBeNull()
      expect(await hlsFilePath(episode.id, 'v1', hlsSignature(episode.id, 'v1'), '96k/seg-00000.m4s')).not.toBeNull()
    }
  })

  it('refuses names that are not stream files', async () => {
    const episode = await withFile()
    for (const file of ['../../audio/x.mp3', '96k/../../x', 'master.m3u8', '96k/seg-0.m4s', '96k/notes.txt']) {
      expect(await hlsFilePath(episode.id, 'v1', null, file)).toBeNull()
    }
    expect(await hlsFilePath(episode.id, '..', null, '96k/seg-00000.m4s')).toBeNull()
  })
})

describe('moveHlsVersions', () => {
  it('moves the stream to a new version, so its old URLs stop working', async () => {
    const episode = await readyEpisode()
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(`${episodeHlsVersionDir(episode.id, 'v1')}/96k`, { recursive: true })
    await writeFile(`${episodeHlsVersionDir(episode.id, 'v1')}/96k/seg-00000.m4s`, 'segment')
    await db.update(episodes).set({ hlsVersion: 'v1' }).where(eq(episodes.id, episode.id))
    await moveHlsVersions([episode.id])
    const version = (await current(episode.id)).hlsVersion!
    expect(version).not.toBe('v1')
    expect(await exists(episodeHlsVersionDir(episode.id, 'v1'))).toBe(false)
    expect(await exists(`${episodeHlsVersionDir(episode.id, version)}/96k/seg-00000.m4s`)).toBe(true)
  })

  it("leaves episodes without a stream alone, and forgets one whose folder is missing", async () => {
    const episode = await readyEpisode()
    await moveHlsVersions([episode.id])
    expect((await current(episode.id)).hlsVersion).toBeNull()
    await db.update(episodes).set({ hlsVersion: 'missing' }).where(eq(episodes.id, episode.id))
    await moveHlsVersions([episode.id])
    expect((await current(episode.id)).hlsVersion).toBeNull()
    await hlsBuildsSettled()
    expect(await exists(episodeHlsDir(episode.id))).toBe(false)
  })
})
