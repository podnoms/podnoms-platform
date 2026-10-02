import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, playbackPositions } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import {
  createEpisode,
  deleteEpisode,
  dismissEpisodeError,
  getEpisode,
  getEpisodeAudio,
  getEpisodeSlug,
  listEpisodes,
  replaceEpisodeAudio,
  retryEpisode,
  savePlaybackPosition,
  updateEpisode,
} from '~/server/episodes.server'
import { episodeAudioPath, episodeSourcePath, episodeWaveformPath, stagedUploadPath } from '~/server/storage.server'
import { resetDb } from '../db'
import {
  createEpisode as insertEpisode,
  createPodcast,
  createUser,
  db,
  exists,
  stageTestImage,
  storeTestImage,
} from '../helpers'

// Processing is tested in episode-processor.server.test.ts.
vi.mock('~/server/episode-processor.server', () => ({ enqueueEpisode: vi.fn() }))

beforeEach(async () => {
  vi.mocked(enqueueEpisode).mockClear()
  await resetDb(db)
})

async function getRow(id: string) {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id))
  return row
}

async function setup() {
  const user = await createUser()
  const podcast = await createPodcast(user.id, { slug: 'show' })
  return { user, podcast }
}

async function touch(path: string, content = 'x') {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

describe('createEpisode from a link', () => {
  it('queues a pending episode titled by the link, with a temporary slug', async () => {
    const { user, podcast } = await setup()
    const episode = await createEpisode(user.id, { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc' })
    expect(episode!.slug).toMatch(/^episode-[0-9a-f]{8}$/)
    expect(await getRow(episode!.id)).toMatchObject({
      status: 'pending',
      title: 'https://youtu.be/abc',
      sourceUrl: 'https://youtu.be/abc',
      description: null,
    })
    expect(enqueueEpisode).toHaveBeenCalledWith(episode!.id)
  })

  it('uses a given title for the title and slug, and stores the description as HTML', async () => {
    const { user, podcast } = await setup()
    const episode = await createEpisode(user.id, {
      podcastId: podcast.id,
      sourceUrl: 'https://youtu.be/abc',
      title: 'My Episode',
      description: 'Line 1\nLine 2',
    })
    expect(episode!.slug).toBe('my-episode')
    expect(await getRow(episode!.id)).toMatchObject({ title: 'My Episode', description: '<p>Line 1<br>Line 2</p>' })
  })

  it('numbers the slug when the title repeats', async () => {
    const { user, podcast } = await setup()
    const input = { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc', title: 'Same' }
    expect((await createEpisode(user.id, input))!.slug).toBe('same')
    expect((await createEpisode(user.id, input))!.slug).toBe('same-2')
  })

  it("returns null for another user's podcast", async () => {
    const { podcast } = await setup()
    const stranger = await createUser()
    expect(await createEpisode(stranger.id, { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc' })).toBeNull()
    expect(await db.select().from(episodes)).toEqual([])
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })
})

async function stageUpload(userId: string, upload: { title: string; durationSeconds: number | null }) {
  const uploadId = crypto.randomUUID()
  const path = stagedUploadPath(userId, uploadId)
  await touch(path, 'audio')
  await writeFile(`${path}.json`, JSON.stringify({ uploadId, ...upload }))
  return uploadId
}

describe('createEpisode from an upload', () => {
  it("uses the upload's title and duration and hands over its file", async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload(user.id, { title: 'Uploaded Title', durationSeconds: 61 })
    const episode = await createEpisode(user.id, { podcastId: podcast.id, uploadId })
    expect(episode!.slug).toBe('uploaded-title')
    expect(await getRow(episode!.id)).toMatchObject({ title: 'Uploaded Title', durationSeconds: 61, sourceUrl: null, status: 'pending' })
    expect(await exists(episodeSourcePath(episode!.id))).toBe(true)
    expect(await exists(stagedUploadPath(user.id, uploadId))).toBe(false)
    expect(enqueueEpisode).toHaveBeenCalledWith(episode!.id)
  })

  it('prefers a title given in the form', async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload(user.id, { title: 'File Title', durationSeconds: null })
    const episode = await createEpisode(user.id, { podcastId: podcast.id, uploadId, title: 'Form Title' })
    expect((await getRow(episode!.id))!.title).toBe('Form Title')
  })

  it('fails when the upload has expired', async () => {
    const { user, podcast } = await setup()
    await expect(createEpisode(user.id, { podcastId: podcast.id, uploadId: crypto.randomUUID() })).rejects.toThrow(
      'That upload has expired',
    )
  })

  it("can't use another user's upload", async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload((await createUser()).id, { title: 'Theirs', durationSeconds: 1 })
    await expect(createEpisode(user.id, { podcastId: podcast.id, uploadId })).rejects.toThrow('That upload has expired')
  })
})

describe('listEpisodes / getEpisode / getEpisodeSlug', () => {
  it("lists a podcast's episodes newest first, with the user's own position", async () => {
    const { user, podcast } = await setup()
    const other = await createUser()
    const old = await insertEpisode(podcast.id, { title: 'Old', createdAt: new Date('2026-01-01') })
    await insertEpisode(podcast.id, { title: 'New', createdAt: new Date('2026-02-01') })
    await db.insert(playbackPositions).values([
      { userId: user.id, episodeId: old.id, positionSeconds: 42 },
      { userId: other.id, episodeId: old.id, positionSeconds: 99 },
    ])
    const list = await listEpisodes(user.id, podcast.id)
    expect(list.map((e) => [e.title, e.positionSeconds])).toEqual([
      ['New', null],
      ['Old', 42],
    ])
  })

  it('finds an episode by podcast and episode slug, for its owner only', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { slug: 'ep' })
    const found = await getEpisode(user.id, 'show', 'ep')
    expect(found?.episode.id).toBe(episode.id)
    expect(found?.podcast).toEqual({ id: podcast.id, title: podcast.title, slug: 'show', imageUrl: null })
    expect(await getEpisode((await createUser()).id, 'show', 'ep')).toBeNull()
    expect(await getEpisode(user.id, 'other', 'ep')).toBeNull()
  })

  it("returns the episode's current slug for its owner only", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { slug: 'current' })
    expect(await getEpisodeSlug(user.id, episode.id)).toBe('current')
    expect(await getEpisodeSlug((await createUser()).id, episode.id)).toBeNull()
  })
})

describe('getEpisodeAudio', () => {
  it('returns only ready episodes', async () => {
    const { podcast } = await setup()
    const ready = await insertEpisode(podcast.id, { status: 'ready', audioMimeType: 'audio/mpeg' })
    const pending = await insertEpisode(podcast.id, { status: 'pending' })
    expect(await getEpisodeAudio(ready.id)).toEqual({ status: 'ready', audioMimeType: 'audio/mpeg' })
    expect(await getEpisodeAudio(pending.id)).toBeNull()
    expect(await getEpisodeAudio('missing')).toBeNull()
  })
})

describe('deleteEpisode', () => {
  it('deletes the episode and all its files', async () => {
    const { user, podcast } = await setup()
    const image = await storeTestImage()
    const episode = await insertEpisode(podcast.id, { status: 'ready', imageUrl: image.url })
    for (const path of [episodeAudioPath(episode.id), episodeSourcePath(episode.id), episodeWaveformPath(episode.id)]) {
      await touch(path)
    }
    expect(await deleteEpisode(user.id, episode.id)).toBe(true)
    expect(await getRow(episode.id)).toBeUndefined()
    for (const path of [episodeAudioPath(episode.id), episodeSourcePath(episode.id), episodeWaveformPath(episode.id), image.path]) {
      expect(await exists(path)).toBe(false)
    }
  })

  it("won't delete an episode mid-download", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'processing' })
    expect(await deleteEpisode(user.id, episode.id)).toBe(false)
    expect(await getRow(episode.id)).toBeDefined()
  })

  it("won't delete an episode while its audio is replaced", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', replacement: { sourceUrl: null } })
    expect(await deleteEpisode(user.id, episode.id)).toBe(false)
    expect(await getRow(episode.id)).toBeDefined()
  })

  it("won't delete another user's episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await deleteEpisode((await createUser()).id, episode.id)).toBe(false)
    expect(await getRow(episode.id)).toBeDefined()
  })

  it('removes playback positions with the episode', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    await savePlaybackPosition(user.id, episode.id, 10)
    await deleteEpisode(user.id, episode.id)
    expect(await db.select().from(playbackPositions)).toEqual([])
  })
})

describe('updateEpisode', () => {
  it('updates the title and sanitised description, keeping the slug', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', slug: 'old' })
    expect(await updateEpisode(user.id, { id: episode.id, title: 'New', description: '<p onclick="x">Hi</p>' })).toBe(true)
    expect(await getRow(episode.id)).toMatchObject({ title: 'New', slug: 'old', description: '<p>Hi</p>' })
  })

  it.each(['pending', 'processing'] as const)("won't edit a %s episode", async (status) => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status, title: 'Before' })
    expect(await updateEpisode(user.id, { id: episode.id, title: 'After' })).toBe(false)
    expect((await getRow(episode.id))!.title).toBe('Before')
  })

  it('allows editing a failed episode', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'failed' })
    expect(await updateEpisode(user.id, { id: episode.id, title: 'Fixed' })).toBe(true)
  })

  it("won't edit another user's episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await updateEpisode((await createUser()).id, { id: episode.id, title: 'Mine' })).toBe(false)
  })

  it('replaces and removes images, deleting the old files', async () => {
    const { user, podcast } = await setup()
    const old = await storeTestImage()
    const episode = await insertEpisode(podcast.id, { status: 'ready', imageUrl: old.url })
    const imageId = await stageTestImage(user.id)
    await updateEpisode(user.id, { id: episode.id, title: 'T', imageId })
    expect((await getRow(episode.id))!.imageUrl).toBe(`/images/${imageId}.jpg`)
    expect(await exists(old.path)).toBe(false)

    await updateEpisode(user.id, { id: episode.id, title: 'T', imageId: null })
    expect((await getRow(episode.id))!.imageUrl).toBeNull()
  })
})

describe('retryEpisode', () => {
  it('requeues a failed episode and clears its error', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'failed', error: 'Boom' })
    expect(await retryEpisode(user.id, episode.id)).toBe(true)
    expect(await getRow(episode.id)).toMatchObject({ status: 'pending', error: null })
    expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
  })

  it.each(['pending', 'processing', 'ready'] as const)('only retries failed episodes, not %s ones', async (status) => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status })
    expect(await retryEpisode(user.id, episode.id)).toBe(false)
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })

  it("won't retry another user's episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'failed' })
    expect(await retryEpisode((await createUser()).id, episode.id)).toBe(false)
  })
})

describe('replaceEpisodeAudio', () => {
  const sourceUrl = 'https://video.test/new'

  it('queues new audio from a link, clearing an old error, and shows it as replacing', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', error: 'Old error' })
    expect(await replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl })).toBe(true)
    expect(await getRow(episode.id)).toMatchObject({ status: 'ready', replacement: { sourceUrl }, error: null })
    expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
    const [listed] = await listEpisodes(user.id, podcast.id)
    expect(listed!.replacing).toBe(true)
    expect((await getEpisode(user.id, 'show', episode.slug))!.episode.replacing).toBe(true)
  })

  it('queues new audio from an upload, handing over its file', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', sourceUrl })
    const uploadId = await stageUpload(user.id, { title: 'New', durationSeconds: 5 })
    expect(await replaceEpisodeAudio(user.id, { id: episode.id, uploadId })).toBe(true)
    expect((await getRow(episode.id))!.replacement).toEqual({ sourceUrl: null })
    expect(await exists(episodeSourcePath(episode.id))).toBe(true)
    expect(await exists(stagedUploadPath(user.id, uploadId))).toBe(false)
    expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
  })

  it('fails when the upload has expired or is someone else’s, leaving the episode alone', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    const theirs = await stageUpload((await createUser()).id, { title: 'Theirs', durationSeconds: 1 })
    for (const uploadId of [crypto.randomUUID(), theirs]) {
      await expect(replaceEpisodeAudio(user.id, { id: episode.id, uploadId })).rejects.toThrow('That upload has expired')
    }
    expect((await getRow(episode.id))!.replacement).toBeNull()
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })

  it("won't replace the audio of an episode that's being processed", async () => {
    const { user, podcast } = await setup()
    for (const status of ['pending', 'processing'] as const) {
      const episode = await insertEpisode(podcast.id, { status })
      expect(await replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl })).toBe(false)
    }
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })

  it.each(['ready', 'failed'] as const)('replaces a %s episode once, even if two requests race', async (status) => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status })
    const results = await Promise.all([
      replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl }),
      replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl: `${sourceUrl}2` }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(enqueueEpisode).toHaveBeenCalledTimes(1)
  })

  describe('of a failed episode', () => {
    const oldUrl = 'https://video.test/broken'

    it('processes it again from a new link, titled from the link if the old one never was', async () => {
      const { user, podcast } = await setup()
      const episode = await insertEpisode(podcast.id, { status: 'failed', error: 'Gone', sourceUrl: oldUrl, title: oldUrl, slug: 'episode-temp' })
      expect(await replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl })).toBe(true)
      expect(await getRow(episode.id)).toMatchObject({
        status: 'pending',
        error: null,
        replacement: null,
        sourceUrl,
        // The processor fills in the real title and slug, as for a new link.
        title: sourceUrl,
        slug: 'episode-temp',
      })
      expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
    })

    it("takes an upload's title, slug and duration if it was never titled", async () => {
      const { user, podcast } = await setup()
      const episode = await insertEpisode(podcast.id, { status: 'failed', sourceUrl: oldUrl, title: oldUrl, slug: 'episode-temp' })
      const uploadId = await stageUpload(user.id, { title: 'My Upload', durationSeconds: 61 })
      expect(await replaceEpisodeAudio(user.id, { id: episode.id, uploadId })).toBe(true)
      expect(await getRow(episode.id)).toMatchObject({
        status: 'pending',
        sourceUrl: null,
        title: 'My Upload',
        slug: 'my-upload',
        durationSeconds: 61,
      })
      expect(await exists(episodeSourcePath(episode.id))).toBe(true)
      expect(await exists(stagedUploadPath(user.id, uploadId))).toBe(false)
    })

    it('keeps the title and slug the user gave it', async () => {
      const { user, podcast } = await setup()
      const episode = await insertEpisode(podcast.id, { status: 'failed', sourceUrl: oldUrl, title: 'Mine', slug: 'mine' })
      const uploadId = await stageUpload(user.id, { title: 'File Title', durationSeconds: 5 })
      expect(await replaceEpisodeAudio(user.id, { id: episode.id, uploadId })).toBe(true)
      expect(await getRow(episode.id)).toMatchObject({ title: 'Mine', slug: 'mine', sourceUrl: null })
    })

    it("removes a failed upload's file when given a link instead", async () => {
      const { user, podcast } = await setup()
      const episode = await insertEpisode(podcast.id, { status: 'failed', title: 'Mine' })
      await touch(episodeSourcePath(episode.id))
      expect(await replaceEpisodeAudio(user.id, { id: episode.id, sourceUrl })).toBe(true)
      expect(await getRow(episode.id)).toMatchObject({ status: 'pending', sourceUrl, title: 'Mine' })
      expect(await exists(episodeSourcePath(episode.id))).toBe(false)
    })
  })

  it("won't replace another user's episode's audio", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await replaceEpisodeAudio((await createUser()).id, { id: episode.id, sourceUrl })).toBe(false)
    expect((await getRow(episode.id))!.replacement).toBeNull()
  })
})

describe('dismissEpisodeError', () => {
  it("clears a ready episode's error, for its owner only", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', error: "Couldn't replace the audio: nope" })
    expect(await dismissEpisodeError((await createUser()).id, episode.id)).toBe(false)
    expect(await dismissEpisodeError(user.id, episode.id)).toBe(true)
    expect((await getRow(episode.id))!.error).toBeNull()
  })

  it("leaves a failed episode's error alone", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'failed', error: 'Broken' })
    expect(await dismissEpisodeError(user.id, episode.id)).toBe(false)
    expect((await getRow(episode.id))!.error).toBe('Broken')
  })
})

describe('savePlaybackPosition', () => {
  it('saves, updates and clears the position, in whole seconds', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    const position = async () => (await db.select().from(playbackPositions))[0]?.positionSeconds

    expect(await savePlaybackPosition(user.id, episode.id, 12.9)).toBe(true)
    expect(await position()).toBe(12)
    await savePlaybackPosition(user.id, episode.id, 30)
    expect(await position()).toBe(30)
    await savePlaybackPosition(user.id, episode.id, 0.5)
    expect(await position()).toBeUndefined()
  })

  it("won't save positions on another user's episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await savePlaybackPosition((await createUser()).id, episode.id, 10)).toBe(false)
    expect(await db.select().from(playbackPositions)).toEqual([])
  })
})
