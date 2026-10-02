import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, type Episode } from '~/server/db/schema'
import { enqueueEpisode, getEpisodeProgress, resumeUnfinishedEpisodes } from '~/server/episode-processor.server'
import { reportError } from '~/server/logger.server'
import { episodeAudioPath, episodeSourcePath, episodeWaveformPath, replacementAudioPath } from '~/server/storage.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db, exists, hasFfmpeg, makeImage, makeTone } from '../helpers'

vi.mock('~/server/logger.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/logger.server')>()),
  reportError: vi.fn(),
}))

const media = process.env.MEDIA_DIR!
let server: Server
let thumbnailUrl: string

beforeAll(async () => {
  // What the fake yt-dlp "downloads" (see tests/fixtures/fake-yt-dlp.mjs).
  process.env.FAKE_YTDLP_AUDIO = await makeTone(join(media, 'fixture.mp3'), 3)
  const png = await makeImage(64, 64)
  server = createServer((_request, response) => response.end(png))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  thumbnailUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/thumb.png`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(async () => {
  vi.mocked(reportError).mockClear()
  await resetDb(db)
})

async function getRow(id: string) {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id))
  return row!
}

// Waits for the queue to finish with the episode.
async function processed(id: string): Promise<Episode> {
  return vi.waitFor(
    async () => {
      const row = await getRow(id)
      if (row.status !== 'ready' && row.status !== 'failed') throw new Error(`Still ${row.status}`)
      if (getEpisodeProgress(id)) throw new Error('Still in progress')
      return row
    },
    { timeout: 20_000, interval: 50 },
  )
}

function link(path: string, params: Record<string, string> = {}) {
  return `https://video.test${path}?${new URLSearchParams(params)}`
}

async function linkEpisode(values: Partial<Episode> & { sourceUrl: string }) {
  const podcast = await createPodcast((await createUser()).id)
  return createEpisode(podcast.id, { title: values.sourceUrl, slug: 'episode-temp', ...values })
}

describe.skipIf(!hasFfmpeg)('episodes from links', () => {
  it("downloads the audio and fills in the source's details", async () => {
    const sourceUrl = link('/watch', { title: 'Real Title', description: 'Para 1\n\nPara 2', duration: '2.6', thumbnail: thumbnailUrl })
    const episode = await linkEpisode({ sourceUrl })
    enqueueEpisode(episode.id)
    const row = await processed(episode.id)

    expect(row).toMatchObject({
      status: 'ready',
      error: null,
      title: 'Real Title',
      slug: 'real-title',
      description: '<p>Para 1</p><p>Para 2</p>',
      durationSeconds: 3,
      audioUrl: `/api/episodes/${episode.id}/audio`,
      audioMimeType: 'audio/mpeg',
      audioSizeBytes: (await stat(episodeAudioPath(episode.id))).size,
    })
    expect(row.publishedAt).toBeInstanceOf(Date)
    expect(row.imageUrl).toMatch(/^\/images\/[0-9a-f-]{36}\.jpg$/)
    expect(await exists(episodeWaveformPath(episode.id))).toBe(true)
    expect(reportError).not.toHaveBeenCalled()

    const args = JSON.parse(await readFile(join(media, 'yt-dlp-args.json'), 'utf8')) as string[]
    expect(args).toContain('--no-playlist')
    expect(args.at(-1)).toBe(sourceUrl)
  })

  it('keeps a title, description and image the user gave', async () => {
    const episode = await linkEpisode({
      sourceUrl: link('/watch', { title: 'Source Title', description: 'Source description', thumbnail: thumbnailUrl }),
      title: 'My Title',
      slug: 'my-title',
      description: '<p>Mine</p>',
      imageUrl: '/images/mine.jpg',
    })
    enqueueEpisode(episode.id)
    expect(await processed(episode.id)).toMatchObject({
      status: 'ready',
      title: 'My Title',
      slug: 'my-title',
      description: '<p>Mine</p>',
      imageUrl: '/images/mine.jpg',
    })
  })

  it('numbers the new slug when another episode has it', async () => {
    const episode = await linkEpisode({ sourceUrl: link('/watch', { title: 'Taken' }) })
    await createEpisode(episode.podcastId, { slug: 'taken' })
    enqueueEpisode(episode.id)
    expect((await processed(episode.id)).slug).toBe('taken-2')
  })

  it('keeps the link as the title when the source has none', async () => {
    const sourceUrl = link('/watch')
    const episode = await linkEpisode({ sourceUrl })
    enqueueEpisode(episode.id)
    expect(await processed(episode.id)).toMatchObject({ status: 'ready', title: sourceUrl, slug: 'episode-temp', durationSeconds: null })
  })

  it("fails with yt-dlp's error, without its prefix", async () => {
    const episode = await linkEpisode({ sourceUrl: link('/fail') })
    enqueueEpisode(episode.id)
    expect(await processed(episode.id)).toMatchObject({ status: 'failed', error: 'This video is unavailable', audioUrl: null })
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'This video is unavailable' }),
      expect.objectContaining({ episodeId: episode.id, podcastId: episode.podcastId, msg: 'Episode processing failed' }),
    )
  })

  it('fails when yt-dlp reports nothing about the download', async () => {
    const episode = await linkEpisode({ sourceUrl: link('/no-info') })
    enqueueEpisode(episode.id)
    expect((await processed(episode.id)).error).toBe('yt-dlp returned no information about the download')
  })

  it('reports download and conversion progress while running', async () => {
    const episode = await linkEpisode({ sourceUrl: link('/watch', { hold: '400' }) })
    enqueueEpisode(episode.id)
    await vi.waitFor(() =>
      expect(getEpisodeProgress(episode.id)).toEqual({
        stage: 'downloading',
        downloadedBytes: 3000,
        totalBytes: 3000,
        bytesPerSecond: 1000,
        secondsLeft: 0,
      }),
    )
    await vi.waitFor(() => expect(getEpisodeProgress(episode.id)).toEqual({ stage: 'converting', percent: null }))
    expect((await getRow(episode.id)).status).toBe('processing')
    await processed(episode.id)
    expect(getEpisodeProgress(episode.id)).toBeNull()
  })
})

describe.skipIf(!hasFfmpeg)('episodes from uploads', () => {
  it('converts the upload to MP3 and removes the source', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const episode = await createEpisode(podcast.id, { title: 'Upload', slug: 'upload', durationSeconds: 99 })
    // Uploads are kept without an extension, so the format is given.
    await makeTone(episodeSourcePath(episode.id), 2, ['-f', 'wav'])

    enqueueEpisode(episode.id)
    const row = await processed(episode.id)
    expect(row).toMatchObject({ status: 'ready', title: 'Upload', slug: 'upload', durationSeconds: 2, sourceUrl: null })
    expect(await exists(episodeAudioPath(episode.id))).toBe(true)
    expect(await exists(episodeSourcePath(episode.id))).toBe(false)
    expect(await exists(episodeWaveformPath(episode.id))).toBe(true)
  })

  it('fails, keeping nothing, when the upload is missing', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const episode = await createEpisode(podcast.id)
    enqueueEpisode(episode.id)
    expect(await processed(episode.id)).toMatchObject({
      status: 'failed',
      error: "The uploaded file is missing or doesn't contain any audio",
    })
    expect(await exists(episodeAudioPath(episode.id))).toBe(false)
  })
})

describe.skipIf(!hasFfmpeg)('replacing audio', () => {
  // Waits for the queue to finish replacing the episode's audio.
  async function replaced(id: string): Promise<Episode> {
    return vi.waitFor(
      async () => {
        const row = await getRow(id)
        if (row.replacement || getEpisodeProgress(id)) throw new Error('Still replacing')
        return row
      },
      { timeout: 20_000, interval: 50 },
    )
  }

  // A ready episode with some old audio and waveform.
  async function readyEpisode(values: Partial<Episode> = {}) {
    const podcast = await createPodcast((await createUser()).id)
    const episode = await createEpisode(podcast.id, {
      title: 'Mine',
      slug: 'mine',
      description: '<p>Mine</p>',
      imageUrl: '/images/mine.jpg',
      status: 'ready',
      sourceUrl: link('/watch', { title: 'Old' }),
      audioUrl: `/api/episodes/x/audio`,
      audioMimeType: 'audio/mpeg',
      audioSizeBytes: 3,
      durationSeconds: 999,
      publishedAt: new Date('2026-01-01'),
      ...values,
    })
    for (const path of [episodeAudioPath(episode.id), episodeWaveformPath(episode.id)]) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, 'old')
    }
    return episode
  }

  it('downloads a new link and swaps it in, keeping the episode live and its details', async () => {
    const episode = await readyEpisode()
    const sourceUrl = link('/watch', { title: 'New Title', description: 'New', duration: '2.6', thumbnail: thumbnailUrl, hold: '200' })
    await db.update(episodes).set({ replacement: { sourceUrl }, error: 'An old error' }).where(eq(episodes.id, episode.id))
    enqueueEpisode(episode.id)

    // Meanwhile it's still ready, with its old audio.
    await vi.waitFor(() => expect(getEpisodeProgress(episode.id)).not.toBeNull())
    expect((await getRow(episode.id)).status).toBe('ready')
    expect(await readFile(episodeAudioPath(episode.id), 'utf8')).toBe('old')

    const row = await replaced(episode.id)
    expect(row).toMatchObject({
      status: 'ready',
      replacement: null,
      error: null,
      title: 'Mine',
      slug: 'mine',
      description: '<p>Mine</p>',
      imageUrl: '/images/mine.jpg',
      sourceUrl,
      durationSeconds: 3,
      audioMimeType: 'audio/mpeg',
      audioSizeBytes: (await stat(episodeAudioPath(episode.id))).size,
      publishedAt: new Date('2026-01-01'),
    })
    // A new URL, so apps that have the old audio fetch the new.
    expect(row.audioUrl).toMatch(new RegExp(`^/api/episodes/${episode.id}/audio\\?v=\\w+$`))
    expect(await readFile(episodeAudioPath(episode.id), 'utf8')).not.toBe('old')
    expect(await readFile(episodeWaveformPath(episode.id), 'utf8')).not.toBe('old')
    expect(await exists(replacementAudioPath(episode.id))).toBe(false)
  })

  it('converts an uploaded file, removing it afterwards', async () => {
    const episode = await readyEpisode()
    await makeTone(episodeSourcePath(episode.id), 2, ['-f', 'wav'])
    await db.update(episodes).set({ replacement: { sourceUrl: null } }).where(eq(episodes.id, episode.id))
    enqueueEpisode(episode.id)

    expect(await replaced(episode.id)).toMatchObject({ status: 'ready', sourceUrl: null, durationSeconds: 2, title: 'Mine' })
    expect(await exists(episodeSourcePath(episode.id))).toBe(false)
    expect(await readFile(episodeAudioPath(episode.id), 'utf8')).not.toBe('old')
  })

  it('keeps the old audio and notes the error when it fails', async () => {
    const episode = await readyEpisode()
    await db.update(episodes).set({ replacement: { sourceUrl: link('/fail') } }).where(eq(episodes.id, episode.id))
    enqueueEpisode(episode.id)

    expect(await replaced(episode.id)).toMatchObject({
      status: 'ready',
      replacement: null,
      error: "Couldn't replace the audio: This video is unavailable",
      sourceUrl: episode.sourceUrl,
      audioUrl: episode.audioUrl,
      durationSeconds: 999,
    })
    expect(await readFile(episodeAudioPath(episode.id), 'utf8')).toBe('old')
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ episodeId: episode.id, msg: 'Episode audio replacement failed' }),
    )
  })

  it('removes a failed upload rather than keeping it to retry', async () => {
    const episode = await readyEpisode()
    await mkdir(dirname(episodeSourcePath(episode.id)), { recursive: true })
    await writeFile(episodeSourcePath(episode.id), 'not audio')
    await db.update(episodes).set({ replacement: { sourceUrl: null } }).where(eq(episodes.id, episode.id))
    enqueueEpisode(episode.id)

    expect((await replaced(episode.id)).error).toMatch(/^Couldn't replace the audio: /)
    expect(await exists(episodeSourcePath(episode.id))).toBe(false)
    expect(await exists(replacementAudioPath(episode.id))).toBe(false)
    expect(await readFile(episodeAudioPath(episode.id), 'utf8')).toBe('old')
  })
})

describe.skipIf(!hasFfmpeg)('the queue', () => {
  it('runs one job at a time, reporting how many are ahead', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const make = (slug: string) =>
      createEpisode(podcast.id, { slug, sourceUrl: link('/watch', { hold: '100' }), title: slug })
    const [a, b, c] = [await make('a'), await make('b'), await make('c')]
    enqueueEpisode(a.id)
    enqueueEpisode(b.id)
    enqueueEpisode(b.id) // Already queued: ignored.
    enqueueEpisode(c.id)
    expect(getEpisodeProgress(b.id)).toEqual({ stage: 'queued', ahead: 1 })
    expect(getEpisodeProgress(c.id)).toEqual({ stage: 'queued', ahead: 2 })
    for (const episode of [a, b, c]) expect((await processed(episode.id)).status).toBe('ready')
  })

  it('reports nothing for episodes it has never seen', () => {
    expect(getEpisodeProgress('unknown')).toBeNull()
  })

  it('ignores episodes that were deleted before their turn', async () => {
    enqueueEpisode('deleted-episode')
    await vi.waitFor(() => expect(getEpisodeProgress('deleted-episode')).toBeNull())
  })
})

describe.skipIf(!hasFfmpeg)('resumeUnfinishedEpisodes', () => {
  it('requeues pending and processing episodes, once per server process', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const pending = await createEpisode(podcast.id, { status: 'pending', sourceUrl: link('/watch'), title: 'p' })
    const processing = await createEpisode(podcast.id, { status: 'processing', sourceUrl: link('/watch'), title: 'q' })
    const failed = await createEpisode(podcast.id, { status: 'failed', sourceUrl: link('/watch'), title: 'f' })
    const replacing = await createEpisode(podcast.id, { status: 'ready', title: 'r', replacement: { sourceUrl: link('/watch') } })

    await resumeUnfinishedEpisodes()
    expect((await processed(pending.id)).status).toBe('ready')
    expect((await processed(processing.id)).status).toBe('ready')
    await vi.waitFor(async () => expect((await getRow(replacing.id)).replacement).toBeNull(), { timeout: 20_000 })
    expect(await exists(episodeAudioPath(replacing.id))).toBe(true)
    expect((await getRow(failed.id)).status).toBe('failed')

    const later = await createEpisode(podcast.id, { status: 'pending', sourceUrl: link('/watch'), title: 'l' })
    await resumeUnfinishedEpisodes()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect((await getRow(later.id)).status).toBe('pending')
  })
})
