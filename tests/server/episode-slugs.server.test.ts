import { beforeEach, describe, expect, it } from 'vitest'
import {
  availableEpisodeSlug,
  isSlugConflict,
  temporaryEpisodeSlug,
  withRandomSuffix,
} from '~/server/episode-slugs.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

describe('availableEpisodeSlug', () => {
  it('slugifies the title, or falls back to "episode"', async () => {
    const show = await createShow((await createUser()).id)
    expect(await availableEpisodeSlug(show.id, 'My First Show!')).toBe('my-first-show')
    expect(await availableEpisodeSlug(show.id, '???')).toBe('episode')
  })

  it('numbers slugs already used in the same show', async () => {
    const show = await createShow((await createUser()).id)
    await createEpisode(show.id, { slug: 'show' })
    await createEpisode(show.id, { slug: 'show-2' })
    expect(await availableEpisodeSlug(show.id, 'Show')).toBe('show-3')
  })

  it("never gives a path under the show that's taken (its manage page, the old /episodes/ links)", async () => {
    const show = await createShow((await createUser()).id)
    expect(await availableEpisodeSlug(show.id, 'Manage')).toBe('manage-2')
    expect(await availableEpisodeSlug(show.id, 'Episodes')).toBe('episodes-2')
  })

  it('ignores slugs in other shows', async () => {
    const user = await createUser()
    const a = await createShow(user.id)
    const b = await createShow(user.id)
    await createEpisode(a.id, { slug: 'show' })
    expect(await availableEpisodeSlug(b.id, 'Show')).toBe('show')
  })

  it("doesn't count the episode's own slug as taken", async () => {
    const show = await createShow((await createUser()).id)
    const episode = await createEpisode(show.id, { slug: 'show' })
    expect(await availableEpisodeSlug(show.id, 'Show', episode.id)).toBe('show')
  })

  it('is not confused by slugs that merely start with the base', async () => {
    const show = await createShow((await createUser()).id)
    await createEpisode(show.id, { slug: 'show-and-tell' })
    expect(await availableEpisodeSlug(show.id, 'Show')).toBe('show')
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
  const conflict = { code: '23505', constraint_name: 'episode_showId_slug_idx' }

  it('recognises the unique violation on episode slugs, wrapped or not', () => {
    expect(isSlugConflict(conflict)).toBe(true)
    expect(isSlugConflict(Object.assign(new Error('Failed query'), { cause: conflict }))).toBe(true)
    expect(isSlugConflict({ cause: { cause: conflict } })).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isSlugConflict({ code: '23505', constraint_name: 'show_slug_unique' })).toBe(false)
    expect(isSlugConflict({ code: '23503', constraint_name: 'episode_showId_slug_idx' })).toBe(false)
    expect(isSlugConflict(new Error('x'))).toBe(false)
    expect(isSlugConflict(null)).toBe(false)
    expect(isSlugConflict('23505')).toBe(false)
  })

  it('recognises the error the database really raises', async () => {
    const show = await createShow((await createUser()).id)
    await createEpisode(show.id, { slug: 'dup' })
    const error = await createEpisode(show.id, { slug: 'dup' }).catch((e: unknown) => e)
    expect(isSlugConflict(error)).toBe(true)
  })
})
