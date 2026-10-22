import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, playbackPositions, podcasts } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { saveLinkArtwork } from '~/server/link-details.server'
import {
  createEpisode,
  createUploadedEpisodes,
  deleteEpisode,
  deletePodcast,
  dismissEpisodeError,
  getEpisode,
  getEpisodeAudio,
  getEpisodeSlug,
  getEpisodeWaveform,
  getPublicEpisode,
  listEpisodes,
  listNeighbouringEpisodes,
  listPublishedEpisodes,
  replaceEpisodeAudio,
  retryEpisode,
  savePlaybackPosition,
  setEpisodePrivacy,
  summariseEpisodes,
  summarisePublishedEpisodes,
  updateEpisode,
} from '~/server/episodes.server'
import { episodeAudioPath, episodeSourcePath, episodeWaveformPath, imagePath, stagedUploadPath } from '~/server/storage.server'
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
// Tested in link-details.server.test.ts.
vi.mock('~/server/link-details.server', () => ({ saveLinkArtwork: vi.fn() }))

beforeEach(async () => {
  vi.mocked(enqueueEpisode).mockClear()
  vi.mocked(saveLinkArtwork).mockClear()
  await resetDb(db)
})

async function getRow(id: string) {
  const [row] = await db.select().from(episodes).where(eq(episodes.id, id))
  return row
}

async function setup(values: Parameters<typeof createPodcast>[1] = {}) {
  const user = await createUser()
  const podcast = await createPodcast(user.id, { slug: 'show', ...values })
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
    // Fetched straight away rather than when its download starts.
    expect(saveLinkArtwork).toHaveBeenCalledWith(episode!.id, 'https://youtu.be/abc')
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

  it('keeps artwork uploaded with the form', async () => {
    const { user, podcast } = await setup()
    const imageId = await stageTestImage(user.id)
    const episode = await createEpisode(user.id, { podcastId: podcast.id, sourceUrl: 'https://video.test/watch', imageId })
    expect((await getRow(episode!.id))!.imageUrl).toBe(`/images/${imageId}.jpg`)
    expect(await exists(imagePath(imageId))).toBe(true)
  })

  it("doesn't fetch the link's artwork when the form has some", async () => {
    const { user, podcast } = await setup()
    const imageId = await stageTestImage(user.id)
    await createEpisode(user.id, { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc', imageId })
    expect(saveLinkArtwork).not.toHaveBeenCalled()
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

  it('keeps artwork uploaded with the form', async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload(user.id, { title: 'Uploaded', durationSeconds: 1 })
    const imageId = await stageTestImage(user.id)
    const episode = await createEpisode(user.id, { podcastId: podcast.id, uploadId, imageId })
    expect((await getRow(episode!.id))!.imageUrl).toBe(`/images/${imageId}.jpg`)
  })

  it('prefers a title given in the form', async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload(user.id, { title: 'File Title', durationSeconds: null })
    const episode = await createEpisode(user.id, { podcastId: podcast.id, uploadId, title: 'Form Title' })
    expect((await getRow(episode!.id))!.title).toBe('Form Title')
  })

  it('fails when the upload has expired, leaving any artwork staged', async () => {
    const { user, podcast } = await setup()
    const imageId = await stageTestImage(user.id)
    await expect(createEpisode(user.id, { podcastId: podcast.id, uploadId: crypto.randomUUID(), imageId })).rejects.toThrow(
      'That upload has expired',
    )
    expect(await exists(imagePath(imageId))).toBe(false)
  })

  it("can't use another user's upload", async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload((await createUser()).id, { title: 'Theirs', durationSeconds: 1 })
    await expect(createEpisode(user.id, { podcastId: podcast.id, uploadId })).rejects.toThrow('That upload has expired')
  })
})

describe('createUploadedEpisodes', () => {
  it('makes an episode of each upload, published in the order given', async () => {
    const { user, podcast } = await setup()
    const first = await stageUpload(user.id, { title: 'Track 1', durationSeconds: 10 })
    const second = await stageUpload(user.id, { title: 'Track 2', durationSeconds: 20 })
    const created = await createUploadedEpisodes(user.id, {
      podcastId: podcast.id,
      episodes: [{ uploadId: first }, { uploadId: second, title: 'Renamed' }],
    })
    const rows = await Promise.all(created!.map((episode) => getRow(episode.id)))
    expect(rows).toMatchObject([
      { title: 'Track 1', durationSeconds: 10, status: 'pending' },
      { title: 'Renamed', durationSeconds: 20, status: 'pending' },
    ])
    expect(rows[1]!.publishedAt!.getTime()).toBeGreaterThan(rows[0]!.publishedAt!.getTime())
    for (const episode of created!) {
      expect(await exists(episodeSourcePath(episode.id))).toBe(true)
      expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
    }
    expect(await exists(stagedUploadPath(user.id, first))).toBe(false)
  })

  it('gives files with the same title different slugs', async () => {
    const { user, podcast } = await setup()
    const uploads = [
      await stageUpload(user.id, { title: 'Untitled', durationSeconds: 1 }),
      await stageUpload(user.id, { title: 'Untitled', durationSeconds: 1 }),
    ]
    const created = await createUploadedEpisodes(user.id, {
      podcastId: podcast.id,
      episodes: uploads.map((uploadId) => ({ uploadId })),
    })
    expect(new Set(created!.map((episode) => episode.slug)).size).toBe(2)
  })

  it('adds nothing when any upload has expired', async () => {
    const { user, podcast } = await setup()
    const uploadId = await stageUpload(user.id, { title: 'Fine', durationSeconds: 1 })
    await expect(
      createUploadedEpisodes(user.id, {
        podcastId: podcast.id,
        episodes: [{ uploadId }, { uploadId: crypto.randomUUID() }],
      }),
    ).rejects.toThrow('Some of the uploads have expired')
    expect(await db.select().from(episodes)).toEqual([])
    expect(await exists(stagedUploadPath(user.id, uploadId))).toBe(true)
  })

  it("returns null for another user's podcast", async () => {
    const { podcast } = await setup()
    const other = await createUser()
    const uploadId = await stageUpload(other.id, { title: 'Mine', durationSeconds: 1 })
    expect(await createUploadedEpisodes(other.id, { podcastId: podcast.id, episodes: [{ uploadId }] })).toBeNull()
    expect(await db.select().from(episodes)).toEqual([])
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

  it('lists a page of episodes', async () => {
    const { user, podcast } = await setup()
    for (const month of [1, 2, 3]) {
      await insertEpisode(podcast.id, { title: `Month ${month}`, createdAt: new Date(`2026-0${month}-01`) })
    }
    const page = await listEpisodes(user.id, podcast.id, { offset: 1, limit: 1 })
    expect(page.map((e) => e.title)).toEqual(['Month 2'])
  })

  it('summarises all episodes, counting the length of ready ones only', async () => {
    const { podcast } = await setup()
    await insertEpisode(podcast.id, { status: 'ready', durationSeconds: 60, createdAt: new Date('2026-01-01') })
    await insertEpisode(podcast.id, { status: 'failed', durationSeconds: 600, createdAt: new Date('2026-03-01') })
    await insertEpisode(podcast.id, { status: 'ready', durationSeconds: 30, createdAt: new Date('2026-02-01') })
    expect(await summariseEpisodes(podcast.id)).toEqual({
      count: 3,
      totalSeconds: 90,
      latestAt: new Date('2026-03-01'),
    })
  })

  it('summarises a podcast with no episodes', async () => {
    const { podcast } = await setup()
    expect(await summariseEpisodes(podcast.id)).toEqual({ count: 0, totalSeconds: 0, latestAt: null })
  })

  it('finds an episode by podcast and episode slug, for its owner only', async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { slug: 'ep' })
    const found = await getEpisode(user.id, 'show', 'ep')
    expect(found?.episode.id).toBe(episode.id)
    expect(found?.podcast).toEqual({ id: podcast.id, title: podcast.title, slug: 'show', imageUrl: null, private: false })
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
  const anyone = { key: null, viewerId: async () => null }

  it('returns only ready episodes', async () => {
    const { podcast } = await setup()
    const ready = await insertEpisode(podcast.id, { status: 'ready', audioMimeType: 'audio/mpeg' })
    const pending = await insertEpisode(podcast.id, { status: 'pending' })
    expect(await getEpisodeAudio(ready.id, anyone)).toEqual({ audioMimeType: 'audio/mpeg' })
    expect(await getEpisodeAudio(pending.id, anyone)).toBeNull()
    expect(await getEpisodeAudio('missing', anyone)).toBeNull()
  })

  it("serves a private podcast's audio with its feed key, or to its owner", async () => {
    const { user, podcast } = await setup({ private: true, feedKey: 'k3y' })
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await getEpisodeAudio(episode.id, anyone)).toBeNull()
    expect(await getEpisodeAudio(episode.id, { ...anyone, key: 'wrong' })).toBeNull()
    expect(await getEpisodeAudio(episode.id, { ...anyone, viewerId: async () => 'someone-else' })).toBeNull()
    expect(await getEpisodeAudio(episode.id, { ...anyone, key: 'k3y' })).not.toBeNull()
    expect(await getEpisodeAudio(episode.id, { ...anyone, viewerId: async () => user.id })).not.toBeNull()
  })

  it("serves a private episode's audio only to its owner, feed key or not", async () => {
    const { user, podcast } = await setup({ private: true, feedKey: 'k3y' })
    const episode = await insertEpisode(podcast.id, { status: 'ready', private: true })
    expect(await getEpisodeAudio(episode.id, { ...anyone, key: 'k3y' })).toBeNull()
    expect(await getEpisodeAudio(episode.id, { ...anyone, viewerId: async () => user.id })).not.toBeNull()
  })

  it("doesn't look up who's asking when it doesn't need to", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    const viewerId = vi.fn(async () => null)
    expect(await getEpisodeAudio(episode.id, { key: null, viewerId })).not.toBeNull()
    expect(viewerId).not.toHaveBeenCalled()
  })
})

describe('setEpisodePrivacy', () => {
  it("hides and shows the owner's episode, and no one else's", async () => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    const isPrivate = async () => (await db.select().from(episodes).where(eq(episodes.id, episode.id)))[0]!.private
    expect(await setEpisodePrivacy((await createUser()).id, episode.id, true)).toBe(false)
    expect(await isPrivate()).toBe(false)
    expect(await setEpisodePrivacy(user.id, episode.id, true)).toBe(true)
    expect(await isPrivate()).toBe(true)
    expect(await setEpisodePrivacy(user.id, episode.id, false)).toBe(true)
    expect(await isPrivate()).toBe(false)
  })
})

describe('deletePodcast', () => {
  const podcastRow = async (id: string) => (await db.select().from(podcasts).where(eq(podcasts.id, id)))[0]

  it('deletes the podcast, its episodes and all their files', async () => {
    const { user, podcast } = await setup()
    const podcastImage = await storeTestImage()
    await db.update(podcasts).set({ imageUrl: podcastImage.url }).where(eq(podcasts.id, podcast.id))
    const episodeImage = await storeTestImage()
    const episode = await insertEpisode(podcast.id, { status: 'ready', imageUrl: episodeImage.url })
    const failed = await insertEpisode(podcast.id, { status: 'failed' })
    const paths = [episodeAudioPath(episode.id), episodeWaveformPath(episode.id), episodeSourcePath(failed.id)]
    for (const path of paths) await touch(path)
    await savePlaybackPosition((await createUser()).id, episode.id, 10)

    expect(await deletePodcast(user.id, podcast.id)).toBe('deleted')
    expect(await podcastRow(podcast.id)).toBeUndefined()
    expect(await db.select().from(episodes)).toEqual([])
    expect(await db.select().from(playbackPositions)).toEqual([])
    for (const path of [...paths, podcastImage.path, episodeImage.path]) expect(await exists(path)).toBe(false)
  })

  it.each([
    ['an episode is mid-download', { status: 'processing' as const }],
    ["an episode's audio is being replaced", { status: 'ready' as const, replacement: { sourceUrl: null } }],
  ])("won't delete it while %s", async (_, values) => {
    const { user, podcast } = await setup()
    const episode = await insertEpisode(podcast.id, values)
    expect(await deletePodcast(user.id, podcast.id)).toBe('busy')
    expect(await podcastRow(podcast.id)).toBeDefined()
    expect(await getRow(episode.id)).toBeDefined()
  })

  it("won't delete another user's podcast", async () => {
    const { podcast } = await setup()
    expect(await deletePodcast((await createUser()).id, podcast.id)).toBeNull()
    expect(await podcastRow(podcast.id)).toBeDefined()
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

  it("won't save positions on another user's unpublished episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await savePlaybackPosition((await createUser()).id, episode.id, 10)).toBe(false)
    expect(await db.select().from(playbackPositions)).toEqual([])
  })

  it("saves listeners' positions on another user's published episode", async () => {
    const { podcast } = await setup()
    const episode = await insertEpisode(podcast.id, { status: 'ready', audioUrl: '/api/episodes/x/audio' })
    const listener = await createUser()
    expect(await savePlaybackPosition(listener.id, episode.id, 10)).toBe(true)
    expect(await db.select().from(playbackPositions)).toMatchObject([{ userId: listener.id, positionSeconds: 10 }])
  })

  it("won't save positions on another user's private episode, or private podcast's", async () => {
    const published = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }
    const { podcast } = await setup()
    const hidden = await insertEpisode(podcast.id, { ...published, private: true })
    const secret = await createPodcast((await createUser()).id, { slug: 'secret', private: true })
    const inSecret = await insertEpisode(secret.id, published)
    const listener = await createUser()
    expect(await savePlaybackPosition(listener.id, hidden.id, 10)).toBe(false)
    expect(await savePlaybackPosition(listener.id, inSecret.id, 10)).toBe(false)
    expect(await db.select().from(playbackPositions)).toEqual([])
  })
})

describe('public episode reads', () => {
  const ready = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }

  async function showWithEpisodes() {
    const owner = await createUser({ name: 'Ada' })
    const podcast = await createPodcast(owner.id, { slug: 'show' })
    const older = await insertEpisode(podcast.id, {
      ...ready,
      slug: 'older',
      sourceUrl: 'https://youtube.example/watch?v=1',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const newer = await insertEpisode(podcast.id, { ...ready, slug: 'newer', publishedAt: new Date('2026-02-01T00:00:00Z') })
    await insertEpisode(podcast.id, { slug: 'pending', status: 'pending' })
    await insertEpisode(podcast.id, { slug: 'processing', status: 'processing' })
    await insertEpisode(podcast.id, { slug: 'failed', status: 'failed', error: 'Boom' })
    await insertEpisode(podcast.id, { slug: 'no-audio', status: 'ready' })
    await insertEpisode(podcast.id, { ...ready, slug: 'hidden', private: true })
    return { owner, podcast, older, newer }
  }

  describe('listPublishedEpisodes', () => {
    it('lists only ready, public episodes with audio, newest first', async () => {
      const { podcast } = await showWithEpisodes()
      const list = await listPublishedEpisodes(podcast.id, null)
      expect(list.map((e) => e.slug)).toEqual(['newer', 'older'])
    })

    it('lists a page of them', async () => {
      const { podcast } = await showWithEpisodes()
      expect((await listPublishedEpisodes(podcast.id, null, { offset: 1, limit: 10 })).map((e) => e.slug)).toEqual([
        'older',
      ])
      expect(await listPublishedEpisodes(podcast.id, null, { offset: 2, limit: 10 })).toEqual([])
    })

    it('summarises only published episodes', async () => {
      const { podcast } = await showWithEpisodes()
      await db.update(episodes).set({ durationSeconds: 100 })
      expect(await summarisePublishedEpisodes(podcast.id)).toEqual({
        count: 2,
        totalSeconds: 200,
        latestAt: new Date('2026-02-01T00:00:00Z'),
      })
    })

    it('summarises a podcast with nothing published', async () => {
      const podcast = await createPodcast((await createUser()).id)
      expect(await summarisePublishedEpisodes(podcast.id)).toEqual({ count: 0, totalSeconds: 0, latestAt: null })
    })

    it("doesn't expose sources, errors or replacement state", async () => {
      const { podcast } = await showWithEpisodes()
      const [episode] = await listPublishedEpisodes(podcast.id, null)
      expect(episode).not.toHaveProperty('sourceUrl')
      expect(episode).not.toHaveProperty('error')
      expect(episode).not.toHaveProperty('replacing')
      expect(episode).not.toHaveProperty('status')
    })

    it("includes only the listener's own position", async () => {
      const { podcast, older } = await showWithEpisodes()
      const listener = await createUser()
      const other = await createUser()
      await savePlaybackPosition(listener.id, older.id, 42)
      await savePlaybackPosition(other.id, older.id, 99)
      const position = async (listenerId: string | null) =>
        (await listPublishedEpisodes(podcast.id, listenerId)).find((e) => e.id === older.id)!.positionSeconds
      expect(await position(listener.id)).toBe(42)
      expect(await position(null)).toBeNull()
      expect(await position((await createUser()).id)).toBeNull()
    })
  })

  describe('listNeighbouringEpisodes', () => {
    it('lists the listed episodes either side of one, newest first', async () => {
      const { podcast } = await showWithEpisodes()
      const months = await Promise.all(
        [3, 4, 5, 6, 7].map((month) =>
          insertEpisode(podcast.id, { ...ready, slug: `m${month}`, publishedAt: new Date(`2026-0${month}-01T00:00:00Z`) }),
        ),
      )
      const slugs = async (episode: (typeof months)[number], each?: number) =>
        (await listNeighbouringEpisodes(episode, each)).map((e) => e.slug)
      expect(await slugs(months[2]!, 2)).toEqual(['m7', 'm6', 'm4', 'm3'])
      expect(await slugs(months[4]!)).toEqual(['m6', 'm5', 'm4'])
      expect(await slugs(months[0]!)).toEqual(['m6', 'm5', 'm4', 'newer', 'older'])
    })

    it('tells apart episodes published at the same moment', async () => {
      const podcast = await createPodcast((await createUser()).id)
      const at = new Date('2026-03-01T00:00:00Z')
      const [a, b] = await Promise.all(['a', 'b'].map((slug) => insertEpisode(podcast.id, { ...ready, slug, publishedAt: at })))
      expect((await listNeighbouringEpisodes(a!)).map((e) => e.slug)).toEqual(['b'])
      expect((await listNeighbouringEpisodes(b!)).map((e) => e.slug)).toEqual(['a'])
    })
  })

  describe('getPublicEpisode', () => {
    it('finds a ready episode, with its podcast', async () => {
      const { owner, older } = await showWithEpisodes()
      const found = await getPublicEpisode('show', 'older', null)
      expect(found!.episode.id).toBe(older.id)
      expect(found!.episode).not.toHaveProperty('sourceUrl')
      expect(found!.podcast).toMatchObject({ slug: 'show', private: false, userId: owner.id, author: 'Ada' })
    })

    it('shows private episodes only to their owner', async () => {
      const { owner } = await showWithEpisodes()
      expect(await getPublicEpisode('show', 'hidden', null)).toBeNull()
      expect(await getPublicEpisode('show', 'hidden', (await createUser()).id)).toBeNull()
      expect(await getPublicEpisode('show', 'hidden', owner.id)).not.toBeNull()
    })

    it("shows a private podcast's episodes only to its owner", async () => {
      const { owner, podcast } = await showWithEpisodes()
      await db.update(podcasts).set({ private: true }).where(eq(podcasts.id, podcast.id))
      expect(await getPublicEpisode('show', 'older', null)).toBeNull()
      expect(await getPublicEpisode('show', 'older', (await createUser()).id)).toBeNull()
      expect(await getPublicEpisode('show', 'older', owner.id)).not.toBeNull()
    })

    it("returns null for episodes that aren't ready, and unknown slugs", async () => {
      await showWithEpisodes()
      for (const slug of ['pending', 'processing', 'failed', 'no-audio', 'nope']) {
        expect(await getPublicEpisode('show', slug, null)).toBeNull()
      }
      expect(await getPublicEpisode('nope', 'older', null)).toBeNull()
    })

    it("includes where the listener left off", async () => {
      const { older } = await showWithEpisodes()
      const listener = await createUser()
      await savePlaybackPosition(listener.id, older.id, 42)
      expect((await getPublicEpisode('show', 'older', listener.id))!.episode.positionSeconds).toBe(42)
      expect((await getPublicEpisode('show', 'older', null))!.episode.positionSeconds).toBeNull()
    })
  })
})

describe('getEpisodeWaveform', () => {
  async function withWaveform(values: Parameters<typeof insertEpisode>[1] = {}, podcastValues: { private?: boolean } = {}) {
    const owner = await createUser()
    const podcast = await createPodcast(owner.id, podcastValues)
    const episode = await insertEpisode(podcast.id, { status: 'ready', audioUrl: '/audio', ...values })
    const path = episodeWaveformPath(episode.id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ version: 1, peaks: Array(1000).fill(255), rms: Array.from({ length: 1000 }, (_, i) => i % 256) }))
    return { owner, episode }
  }

  it("gives anyone a listed episode's waveform, resampled for the player", async () => {
    const { episode } = await withWaveform()
    const values = await getEpisodeWaveform(null, episode.id)
    expect(values).toHaveLength(400)
    expect(values!.every(Number.isInteger)).toBe(true)
  })

  it("gives a private episode's waveform only to its owner", async () => {
    const { owner, episode } = await withWaveform({ private: true })
    expect(await getEpisodeWaveform(null, episode.id)).toBeNull()
    expect(await getEpisodeWaveform((await createUser()).id, episode.id)).toBeNull()
    expect(await getEpisodeWaveform(owner.id, episode.id)).toHaveLength(400)
  })

  it("is null for a private podcast's episode, or one without a waveform", async () => {
    const { episode } = await withWaveform({}, { private: true })
    expect(await getEpisodeWaveform(null, episode.id)).toBeNull()
    const owner = await createUser()
    const bare = await insertEpisode((await createPodcast(owner.id)).id, { status: 'ready', audioUrl: '/audio' })
    expect(await getEpisodeWaveform(owner.id, bare.id)).toBeNull()
  })
})
