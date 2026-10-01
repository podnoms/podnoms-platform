import { beforeEach, describe, expect, it } from 'vitest'
import {
  availableEpisodeSlug,
  isSlugConflict,
  temporaryEpisodeSlug,
  withRandomSuffix,
} from '~/server/episode-slugs.server'
import { resetDb } from '../../test/db'
import { createEpisode, createPodcast, createUser, db } from '../../test/helpers'

beforeEach(() => resetDb(db))

describe('availableEpisodeSlug', () => {
  it('slugifies the title, or falls back to "episode"', async () => {
    const podcast = await createPodcast((await createUser()).id)
    expect(await availableEpisodeSlug(podcast.id, 'My First Show!')).toBe('my-first-show')
    expect(await availableEpisodeSlug(podcast.id, '???')).toBe('episode')
  })

  it('numbers slugs already used in the same podcast', async () => {
    const podcast = await createPodcast((await createUser()).id)
    await createEpisode(podcast.id, { slug: 'show' })
    await createEpisode(podcast.id, { slug: 'show-2' })
    expect(await availableEpisodeSlug(podcast.id, 'Show')).toBe('show-3')
  })

  it('ignores slugs in other podcasts', async () => {
    const user = await createUser()
    const a = await createPodcast(user.id)
    const b = await createPodcast(user.id)
    await createEpisode(a.id, { slug: 'show' })
    expect(await availableEpisodeSlug(b.id, 'Show')).toBe('show')
  })

  it("doesn't count the episode's own slug as taken", async () => {
    const podcast = await createPodcast((await createUser()).id)
    const episode = await createEpisode(podcast.id, { slug: 'show' })
    expect(await availableEpisodeSlug(podcast.id, 'Show', episode.id)).toBe('show')
  })

  it('is not confused by slugs that merely start with the base', async () => {
    const podcast = await createPodcast((await createUser()).id)
    await createEpisode(podcast.id, { slug: 'show-and-tell' })
    expect(await availableEpisodeSlug(podcast.id, 'Show')).toBe('show')
  })
})

describe('temporaryEpisodeSlug / withRandomSuffix', () => {
  it('makes random, URL-safe slugs', () => {
    expect(temporaryEpisodeSlug()).toMatch(/^episode-[0-9a-f]{8}$/)
    expect(temporaryEpisodeSlug()).not.toBe(temporaryEpisodeSlug())
    expect(withRandomSuffix('show')).toMatch(/^show-[0-9a-f]{4}$/)
  })
})

describe('isSlugConflict', () => {
  const conflict = { code: '23505', constraint_name: 'episode_podcastId_slug_idx' }

  it('recognises the unique violation on episode slugs, wrapped or not', () => {
    expect(isSlugConflict(conflict)).toBe(true)
    expect(isSlugConflict(Object.assign(new Error('Failed query'), { cause: conflict }))).toBe(true)
    expect(isSlugConflict({ cause: { cause: conflict } })).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isSlugConflict({ code: '23505', constraint_name: 'podcast_slug_unique' })).toBe(false)
    expect(isSlugConflict({ code: '23503', constraint_name: 'episode_podcastId_slug_idx' })).toBe(false)
    expect(isSlugConflict(new Error('x'))).toBe(false)
    expect(isSlugConflict(null)).toBe(false)
    expect(isSlugConflict('23505')).toBe(false)
  })

  it('recognises the error the database really raises', async () => {
    const podcast = await createPodcast((await createUser()).id)
    await createEpisode(podcast.id, { slug: 'dup' })
    const error = await createEpisode(podcast.id, { slug: 'dup' }).catch((e: unknown) => e)
    expect(isSlugConflict(error)).toBe(true)
  })
})
