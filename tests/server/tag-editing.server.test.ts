import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, podcasts, tags } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { createEpisode, getEpisode, updateEpisode } from '~/server/episodes.server'
import { createPodcast, updatePodcast } from '~/server/podcasts.server'
import { stagedUploadPath } from '~/server/storage.server'
import { getEpisodeTags, getPodcastTags } from '~/server/tags.server'
import { resetDb } from '../db'
import { createEpisode as insertEpisode, createUser, db } from '../helpers'

vi.mock('~/server/episode-processor.server', () => ({ enqueueEpisode: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(enqueueEpisode).mockReset()
})

describe('tags in show and episode edits', () => {
  it('reuses tags between show creation and link episodes before queueing them', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show', tags: [' House ', 'deep   HOUSE', 'house'] })
    const episode = await createEpisode(user.id, {
      podcastId: podcast.id, sourceUrl: 'https://video.test/mix', tags: ['HOUSE', 'techno'],
    })
    const showTags = await getPodcastTags(podcast.id)
    const episodeTags = await getEpisodeTags(episode!.id)
    expect(showTags.map((tag) => tag.name)).toEqual(['deep house', 'house'])
    expect(episodeTags.map((tag) => tag.name)).toEqual(['house', 'techno'])
    expect(episodeTags[0]!.id).toBe(showTags[1]!.id)
    expect(await db.select().from(tags)).toHaveLength(3)
    expect(enqueueEpisode).toHaveBeenCalledWith(episode!.id)
  })

  it('saves tags on an uploaded episode', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show' })
    const uploadId = crypto.randomUUID()
    const path = stagedUploadPath(user.id, uploadId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'audio')
    await writeFile(`${path}.json`, JSON.stringify({ uploadId, title: 'Mix', durationSeconds: 60 }))
    const episode = await createEpisode(user.id, { podcastId: podcast.id, uploadId, tags: ['ambient'] })
    expect(await getEpisodeTags(episode!.id)).toEqual([{ id: expect.any(String), name: 'ambient', slug: 'ambient' }])
    expect(enqueueEpisode).toHaveBeenCalledWith(episode!.id)
  })

  it('preserves omitted tags and replaces or clears tags explicitly for both entities', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show', tags: ['house'] })
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    await updateEpisode(user.id, { id: episode.id, title: episode.title, tags: ['house'] })
    await updatePodcast(user.id, { id: podcast.id, title: 'Edited show' })
    await updateEpisode(user.id, { id: episode.id, title: 'Edited mix' })
    expect((await getPodcastTags(podcast.id)).map((tag) => tag.name)).toEqual(['house'])
    expect((await getEpisodeTags(episode.id)).map((tag) => tag.name)).toEqual(['house'])
    await updatePodcast(user.id, { id: podcast.id, title: 'Edited show', tags: ['techno'] })
    await updateEpisode(user.id, { id: episode.id, title: 'Edited mix', tags: ['ambient'] })
    expect((await getPodcastTags(podcast.id)).map((tag) => tag.name)).toEqual(['techno'])
    expect((await getEpisodeTags(episode.id)).map((tag) => tag.name)).toEqual(['ambient'])
    await updatePodcast(user.id, { id: podcast.id, title: 'Edited show', tags: [] })
    await updateEpisode(user.id, { id: episode.id, title: 'Edited mix', tags: [] })
    expect(await getPodcastTags(podcast.id)).toEqual([])
    expect(await getEpisodeTags(episode.id)).toEqual([])
    // Previously used names remain available for autocomplete.
    expect(await db.select().from(tags)).toHaveLength(3)
  })

  it('cannot tag or create episodes in another owner’s show', async () => {
    const owner = await createUser()
    const stranger = await createUser()
    const podcast = await createPodcast(owner.id, { title: 'Show', tags: ['house'] })
    const episode = await insertEpisode(podcast.id, { status: 'ready' })
    expect(await updatePodcast(stranger.id, { id: podcast.id, title: 'Changed', tags: ['secret'] })).toBe(false)
    expect(await updateEpisode(stranger.id, { id: episode.id, title: 'Changed', tags: ['secret'] })).toBe(false)
    expect(await createEpisode(stranger.id, {
      podcastId: podcast.id, sourceUrl: 'https://video.test/mix', tags: ['secret'],
    })).toBeNull()
    expect((await getPodcastTags(podcast.id)).map((tag) => tag.name)).toEqual(['house'])
    expect(await getEpisodeTags(episode.id)).toEqual([])
    expect(await db.select().from(tags)).toHaveLength(1)
  })

  it('rolls back details and creation if tags fail validation', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show', tags: ['house'] })
    const episode = await insertEpisode(podcast.id, { status: 'ready', title: 'Mix' })
    await expect(updatePodcast(user.id, { id: podcast.id, title: 'Changed', tags: [''] })).rejects.toThrow()
    await expect(updateEpisode(user.id, { id: episode.id, title: 'Changed', tags: [''] })).rejects.toThrow()
    expect((await db.select().from(podcasts).where(eq(podcasts.id, podcast.id)))[0]!.title).toBe('Show')
    expect((await getEpisode(user.id, podcast.slug, episode.slug))!.episode.title).toBe('Mix')
    await expect(createPodcast(user.id, { title: 'Invalid show', tags: [''] })).rejects.toThrow()
    await expect(createEpisode(user.id, {
      podcastId: podcast.id, sourceUrl: 'https://video.test/mix', tags: [''],
    })).rejects.toThrow()
    expect(await db.select().from(podcasts)).toHaveLength(1)
    expect(await db.select().from(episodes)).toHaveLength(1)
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })
})
