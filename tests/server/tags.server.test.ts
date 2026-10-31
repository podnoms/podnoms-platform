import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { tagNamesSchema } from '~/lib/tag-schema'
import { slugify } from '~/lib/slug'
import { db as appDb } from '~/server/db/client.server'
import { episodeLikes, episodes, episodeTags, playbackPositions, shows, showTags, tags } from '~/server/db/schema'
import {
  countTagEpisodes,
  getEpisodeTags,
  getShowTags,
  getTag,
  getTagBySlug,
  listTagEpisodes,
  searchTags,
  syncEpisodeTags,
  syncShowTags,
  withEpisodeTags,
} from '~/server/tags.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/api/episodes/example/audio' }
const page = { offset: 0, limit: 50 }
const tagShow = (id: string, names: string[]) => appDb.transaction((tx) => syncShowTags(tx, id, names))
const tagEpisode = (id: string, names: string[]) => appDb.transaction((tx) => syncEpisodeTags(tx, id, names))

async function makeShow(values: Parameters<typeof createShow>[1] = {}) {
  const owner = await createUser()
  const show = await createShow(owner.id, values)
  return { owner, show }
}

describe('tag vocabulary and associations', () => {
  it('normalises names and shares one tag between shows and episodes', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id)
    await tagShow(show.id, [' Deep   House ', 'DEEP HOUSE', 'Techno'])
    await tagEpisode(episode.id, ['deep house'])
    const showTags = await getShowTags(show.id)
    expect(showTags.map(({ name }) => name)).toEqual(['deep house', 'techno'])
    expect(await getEpisodeTags(episode.id)).toEqual([showTags[0]])
    expect(await db.select().from(tags)).toHaveLength(2)
    expect(await getTag(showTags[0]!.id)).toEqual(showTags[0])
    expect(await getTag('missing')).toBeNull()
  })

  it('rejects blank, oversized and excessive tags', async () => {
    for (const invalid of [[' '], ['x'.repeat(51)], Array.from({ length: 11 }, (_, i) => `tag ${i}`)]) {
      expect(tagNamesSchema.safeParse(invalid).success).toBe(false)
    }
    expect(tagNamesSchema.parse([' House ', 'HOUSE'])).toEqual(['house'])
    expect(tagNamesSchema.parse([])).toEqual([])
    const { show } = await makeShow()
    await expect(tagShow(show.id, [''])).rejects.toThrow()
    expect(await db.select().from(tags)).toEqual([])
  })

  it('enforces case-insensitive uniqueness in the database', async () => {
    await db.insert(tags).values({ name: 'House', slug: 'house' })
    await expect(db.insert(tags).values({ name: 'HOUSE', slug: 'another-slug' })).rejects.toThrow()
    const { show } = await makeShow()
    await tagShow(show.id, ['house'])
    expect((await getShowTags(show.id)).map(({ name }) => name)).toEqual(['House'])
  })

  it('gives tags stable readable slugs, with numbered collisions and accent folding', async () => {
    const { show } = await makeShow()
    await tagShow(show.id, ['deep house', 'café', '🎵'])
    const first = await getShowTags(show.id)
    expect(Object.fromEntries(first.map((tag) => [tag.name, tag.slug]))).toEqual({
      'deep house': 'deep-house', café: 'cafe', '🎵': 'tag',
    })
    await tagShow(show.id, ['deep-house', 'deep-house-2', 'cafe', '🎶'])
    const other = await getShowTags(show.id)
    expect(Object.fromEntries(other.map((tag) => [tag.name, tag.slug]))).toEqual({
      'deep-house': 'deep-house-2', 'deep-house-2': 'deep-house-2-2', cafe: 'cafe-2', '🎶': 'tag-2',
    })
    for (const tag of [...first, ...other]) {
      expect(await getTagBySlug(tag.slug)).toEqual(tag)
      expect(await getTagBySlug(tag.id)).toBeNull()
    }
    await tagShow(show.id, ['Deep House'])
    expect(await getShowTags(show.id)).toEqual([first.find((tag) => tag.name === 'deep house')])
    expect(await getTagBySlug('missing')).toBeNull()
    await expect(db.insert(tags).values({ name: 'different', slug: 'deep-house' })).rejects.toThrow()
  })

  it('replaces and clears associations while retaining tags for reuse', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id)
    await tagShow(show.id, ['house', 'techno'])
    await tagEpisode(episode.id, ['house'])
    await tagShow(show.id, ['ambient'])
    expect((await getShowTags(show.id)).map(({ name }) => name)).toEqual(['ambient'])
    expect((await getEpisodeTags(episode.id)).map(({ name }) => name)).toEqual(['house'])
    await tagEpisode(episode.id, [])
    await tagShow(show.id, [])
    expect(await getEpisodeTags(episode.id)).toEqual([])
    expect(await getShowTags(show.id)).toEqual([])
    expect((await searchTags('')).map(({ name }) => name)).toEqual(['ambient', 'house', 'techno'])
  })

  it('rolls tag creation and association changes back with the enclosing edit', async () => {
    const { show } = await makeShow()
    await tagShow(show.id, ['house'])
    await expect(appDb.transaction(async (tx) => {
      await tx.update(shows).set({ title: 'Changed' }).where(eq(shows.id, show.id))
      await syncShowTags(tx, show.id, ['new tag'])
      throw new Error('failed edit')
    })).rejects.toThrow('failed edit')
    expect((await getShowTags(show.id)).map(({ name }) => name)).toEqual(['house'])
    expect(await searchTags('new tag')).toEqual([])
    expect((await db.select().from(shows))[0]!.title).toBe(show.title)
  })

  it('cascades links on deleting an episode, show or tag', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id)
    await tagShow(show.id, ['house'])
    await tagEpisode(episode.id, ['house'])
    await db.delete(episodes).where(eq(episodes.id, episode.id))
    expect(await db.select().from(episodeTags)).toEqual([])
    expect(await getShowTags(show.id)).toHaveLength(1)
    await db.delete(shows).where(eq(shows.id, show.id))
    expect(await db.select().from(showTags)).toEqual([])
    const other = await makeShow()
    await tagShow(other.show.id, ['house'])
    await db.delete(tags)
    expect(await db.select().from(showTags)).toEqual([])
  })

  it('adds direct tags to a page in order, including untagged episodes', async () => {
    const { show } = await makeShow()
    const first = await createEpisode(show.id)
    const second = await createEpisode(show.id)
    await tagEpisode(first.id, ['techno', 'acid'])
    const rows = await withEpisodeTags([{ id: second.id, title: 'Second' }, { id: first.id, title: 'First' }])
    expect(rows.map(({ title, tags: values }) => [title, values.map(({ name }) => name)])).toEqual([
      ['Second', []], ['First', ['acid', 'techno']],
    ])
    expect(await withEpisodeTags([])).toEqual([])
  })
})

describe('tag search', () => {
  it('normalises queries, prefers prefixes and treats SQL wildcards literally', async () => {
    await db.insert(tags).values(['deep house', 'house', 'house music', '100% house', 'under_score', 'back\\slash']
      .map((name) => ({ name, slug: slugify(name, 'tag') })))
    expect((await searchTags(' HOUSE ')).map(({ name }) => name)).toEqual(['house', 'house music', '100% house', 'deep house'])
    expect((await searchTags('%')).map(({ name }) => name)).toEqual(['100% house'])
    expect((await searchTags('_')).map(({ name }) => name)).toEqual(['under_score'])
    expect((await searchTags('\\')).map(({ name }) => name)).toEqual(['back\\slash'])
    expect(await searchTags("' OR true --")).toEqual([])
  })

  it('limits suggestions even for an empty query', async () => {
    await db.insert(tags).values(Array.from({ length: 20 }, (_, i) => ({ name: `tag ${i}`, slug: `tag-${i}` })))
    expect(await searchTags('')).toHaveLength(12)
  })
})

describe('tagged mixes', () => {
  it('finds direct and show tags once each, excluding all non-public or unplayable episodes', async () => {
    const { owner, show } = await makeShow()
    const { show: directShow } = await makeShow()
    const secretShow = await createShow(owner.id, { private: true })
    const both = await createEpisode(show.id, { ...ready, slug: 'both', publishedAt: new Date('2026-02-01') })
    await createEpisode(show.id, { ...ready, slug: 'inherited', publishedAt: new Date('2026-01-01') })
    const direct = await createEpisode(directShow.id, { ...ready, slug: 'direct', publishedAt: new Date('2026-03-01') })
    const unrelated = await createEpisode(directShow.id, { ...ready, slug: 'unrelated' })
    const secret = await createEpisode(secretShow.id, { ...ready, slug: 'secret' })
    const hidden = await createEpisode(show.id, { ...ready, private: true })
    const pending = await createEpisode(show.id, { audioUrl: ready.audioUrl, status: 'pending' })
    const failed = await createEpisode(show.id, { audioUrl: ready.audioUrl, status: 'failed' })
    const silent = await createEpisode(show.id, { status: 'ready' })
    await tagShow(show.id, ['house'])
    await tagShow(secretShow.id, ['house'])
    for (const episode of [both, direct, secret, hidden, pending, failed, silent]) await tagEpisode(episode.id, ['house'])
    await tagEpisode(unrelated.id, ['techno'])
    const [tag] = await getShowTags(show.id)
    for (const viewer of [null, owner.id]) {
      const rows = await listTagEpisodes(tag!.id, viewer, 'newest', page)
      expect(rows.map(({ slug }) => slug)).toEqual(['direct', 'both', 'inherited'])
      expect(rows.find(({ id }) => id === both.id)!.show.isOwner).toBe(viewer === owner.id)
      expect(rows[0]!.show).not.toHaveProperty('userId')
    }
    expect(await countTagEpisodes(tag!.id)).toBe(3)
    expect(await countTagEpisodes('missing')).toBe(0)
    expect(await listTagEpisodes('missing', null, 'popular', page)).toEqual([])
  })

  it('sorts popularity by recent likes, retains unliked mixes and includes listener state', async () => {
    const { show } = await makeShow()
    await tagShow(show.id, ['house'])
    const [tag] = await getShowTags(show.id)
    const popular = await createEpisode(show.id, { ...ready, slug: 'popular', publishedAt: new Date('2026-01-01') })
    const stale = await createEpisode(show.id, { ...ready, slug: 'stale', publishedAt: new Date('2026-03-01') })
    const unliked = await createEpisode(show.id, { ...ready, slug: 'unliked', publishedAt: new Date('2026-04-01') })
    const listener = await createUser()
    await db.insert(episodeLikes).values({ userId: listener.id, episodeId: popular.id })
    for (let i = 0; i < 3; i++) await db.insert(episodeLikes).values({
      userId: (await createUser()).id, episodeId: stale.id, createdAt: new Date('2020-01-01'),
    })
    await db.insert(playbackPositions).values({ userId: listener.id, episodeId: popular.id, positionSeconds: 42 })
    await tagEpisode(popular.id, ['acid'])
    const rows = await listTagEpisodes(tag!.id, listener.id, 'popular', page)
    expect(rows.map(({ slug }) => slug)).toEqual(['popular', 'stale', 'unliked'])
    expect(rows[0]).toMatchObject({ liked: true, likeCount: 1, positionSeconds: 42, tags: [{ name: 'acid' }] })
    expect((await listTagEpisodes(tag!.id, listener.id, 'newest', page)).map(({ id }) => id)).toEqual([unliked.id, stale.id, popular.id])
  })

  it('uses import date for missing source dates and stable IDs to paginate tied dates', async () => {
    const { show } = await makeShow()
    await tagShow(show.id, ['house'])
    const [tag] = await getShowTags(show.id)
    const date = new Date('2026-05-01')
    await createEpisode(show.id, { ...ready, id: 'a', createdAt: date })
    await createEpisode(show.id, { ...ready, id: 'b', createdAt: new Date('2026-06-01'), publishedAt: date })
    for (const sort of ['newest', 'popular'] as const) {
      expect((await listTagEpisodes(tag!.id, null, sort, { offset: 0, limit: 1 })).map(({ id }) => id)).toEqual(['b'])
      expect((await listTagEpisodes(tag!.id, null, sort, { offset: 1, limit: 1 })).map(({ id }) => id)).toEqual(['a'])
      expect(await listTagEpisodes(tag!.id, null, sort, { offset: 2, limit: 1 })).toEqual([])
    }
  })
})
