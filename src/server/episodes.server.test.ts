import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, playbackPositions } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import {
  createEpisode,
  deleteEpisode,
  getEpisode,
  getEpisodeAudio,
  getEpisodeSlug,
  listEpisodes,
  retryEpisode,
  savePlaybackPosition,
  updateEpisode,
} from '~/server/episodes.server'
import { episodeAudioPath, episodeSourcePath, episodeWaveformPath, stagedUploadPath } from '~/server/storage.server'
import { resetDb } from '../../test/db'
import {
  createEpisode as insertEpisode,
  createPodcast,
  createUser,
  db,
  exists,
  stageTestImage,
  storeTestImage,
} from '../../test/helpers'

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

describe('createEpisode from an upload', () => {
  async function stageUpload(userId: string, upload: { title: string; durationSeconds: number | null }) {
    const uploadId = crypto.randomUUID()
    const path = stagedUploadPath(userId, uploadId)
    await touch(path, 'audio')
    await writeFile(`${path}.json`, JSON.stringify({ uploadId, ...upload }))
    return uploadId
  }

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
