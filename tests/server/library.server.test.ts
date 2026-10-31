import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodeLikes, shows } from '~/server/db/schema'
import { getPublicEpisode, listPublishedEpisodes, savePlaybackPosition } from '~/server/episodes.server'
import {
  countExploreShows,
  countFollowers,
  countLikedEpisodes,
  listContinueListening,
  listExploreShows,
  listFollowedShows,
  listFollowingEpisodes,
  listLatestEpisodes,
  listLikedEpisodes,
  listPopularEpisodes,
  setEpisodeLike,
  setShowFollow,
} from '~/server/library.server'
import { getPublicShow } from '~/server/shows.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }
const page = { offset: 0, limit: 50 }

async function makeShow(slug = 'show', values: Parameters<typeof createShow>[1] = {}) {
  const owner = await createUser({ name: 'Ada' })
  const show = await createShow(owner.id, { slug, title: slug, ...values })
  return { owner, show }
}

describe('setEpisodeLike', () => {
  it('likes and unlikes, counting everyone who likes it', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id, ready)
    const [ann, bob] = [await createUser(), await createUser()]
    expect(await setEpisodeLike(ann.id, episode.id, true)).toEqual({ liked: true, likeCount: 1 })
    // Liking twice is the same as once.
    expect(await setEpisodeLike(ann.id, episode.id, true)).toEqual({ liked: true, likeCount: 1 })
    expect(await setEpisodeLike(bob.id, episode.id, true)).toEqual({ liked: true, likeCount: 2 })
    expect(await setEpisodeLike(ann.id, episode.id, false)).toEqual({ liked: false, likeCount: 1 })
  })

  it("won't like what the user can't see", async () => {
    const { owner, show } = await makeShow()
    const hidden = await createEpisode(show.id, { ...ready, private: true })
    const pending = await createEpisode(show.id, { status: 'pending' })
    const listener = await createUser()
    expect(await setEpisodeLike(listener.id, hidden.id, true)).toBeNull()
    expect(await setEpisodeLike(listener.id, pending.id, true)).toBeNull()
    expect(await setEpisodeLike(listener.id, 'missing', true)).toBeNull()
    // Owners can like their own private episodes.
    expect(await setEpisodeLike(owner.id, hidden.id, true)).toEqual({ liked: true, likeCount: 1 })
  })

  it('shows on the public episode list and page, with whether the listener likes it', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id, { ...ready, slug: 'ep' })
    const listener = await createUser()
    await setEpisodeLike(listener.id, episode.id, true)
    await setEpisodeLike((await createUser()).id, episode.id, true)
    expect(await listPublishedEpisodes(show.id, listener.id)).toMatchObject([{ likeCount: 2, liked: true }])
    expect(await listPublishedEpisodes(show.id, null)).toMatchObject([{ likeCount: 2, liked: false }])
    expect((await getPublicEpisode('show', 'ep', listener.id))!.episode).toMatchObject({ likeCount: 2, liked: true })
  })
})

describe('listLikedEpisodes', () => {
  it('lists what the user likes, most recently liked first, with its show', async () => {
    const { owner, show } = await makeShow()
    const first = await createEpisode(show.id, { ...ready, slug: 'first' })
    const second = await createEpisode(show.id, { ...ready, slug: 'second' })
    await createEpisode(show.id, { ...ready, slug: 'not-liked' })
    const listener = await createUser()
    await setEpisodeLike(listener.id, first.id, true)
    await setEpisodeLike(listener.id, second.id, true)
    await db.update(episodeLikes).set({ createdAt: new Date('2026-01-01') }).where(eq(episodeLikes.episodeId, first.id))
    const liked = await listLikedEpisodes(listener.id, page)
    expect(liked.map((e) => e.slug)).toEqual(['second', 'first'])
    expect(liked[0]).toMatchObject({ liked: true, likeCount: 1, show: { slug: 'show', title: 'show', isOwner: false } })
    expect(liked[0]!.show).not.toHaveProperty('userId')
    expect(await countLikedEpisodes(listener.id)).toBe(2)
    expect((await listLikedEpisodes(owner.id, page)).length).toBe(0)
  })

  it('leaves out episodes since made private', async () => {
    const { show } = await makeShow()
    const episode = await createEpisode(show.id, ready)
    const listener = await createUser()
    await setEpisodeLike(listener.id, episode.id, true)
    await db.update(shows).set({ private: true }).where(eq(shows.id, show.id))
    expect(await listLikedEpisodes(listener.id, page)).toEqual([])
    expect(await countLikedEpisodes(listener.id)).toBe(0)
  })
})

describe('follows', () => {
  it('follows and unfollows, counting followers', async () => {
    const { show } = await makeShow()
    const [ann, bob] = [await createUser(), await createUser()]
    expect(await setShowFollow(ann.id, show.id, true)).toEqual({ following: true, followerCount: 1 })
    expect(await setShowFollow(ann.id, show.id, true)).toEqual({ following: true, followerCount: 1 })
    expect(await setShowFollow(bob.id, show.id, true)).toEqual({ following: true, followerCount: 2 })
    expect(await setShowFollow(ann.id, show.id, false)).toEqual({ following: false, followerCount: 1 })
    expect(await countFollowers(show.id)).toBe(1)
  })

  it("won't follow someone else's private show", async () => {
    const { show } = await makeShow('secret', { private: true })
    expect(await setShowFollow((await createUser()).id, show.id, true)).toBeNull()
    expect(await setShowFollow((await createUser()).id, 'missing', true)).toBeNull()
  })

  it('shows on the public show page', async () => {
    const { show } = await makeShow()
    const listener = await createUser()
    await setShowFollow(listener.id, show.id, true)
    expect(await getPublicShow('show', listener.id)).toMatchObject({ followerCount: 1, following: true })
    expect(await getPublicShow('show', null)).toMatchObject({ followerCount: 1, following: false })
  })

  it("lists followed shows by title, even empty ones, but not ones made private since", async () => {
    const { show: zed } = await makeShow('zed')
    const { show: abc } = await makeShow('abc')
    const { show: gone } = await makeShow('gone')
    await createEpisode(zed.id, { ...ready, publishedAt: new Date('2026-03-01T00:00:00Z') })
    await createEpisode(zed.id, ready)
    const listener = await createUser()
    for (const p of [zed, abc, gone]) await setShowFollow(listener.id, p.id, true)
    await db.update(shows).set({ private: true }).where(eq(shows.id, gone.id))
    const followed = await listFollowedShows(listener.id)
    expect(followed.map((p) => p.slug)).toEqual(['abc', 'zed'])
    expect(followed[0]).toMatchObject({ episodeCount: 0, latestAt: null, following: true, followerCount: 1, author: 'Ada' })
    expect(followed[1]).toMatchObject({ episodeCount: 2 })
  })

  it("lists followed shows' listed episodes, newest first", async () => {
    const { show: a } = await makeShow('a')
    const { show: b } = await makeShow('b')
    const { show: unfollowed } = await makeShow('c')
    await createEpisode(a.id, { ...ready, slug: 'a1', publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(b.id, { ...ready, slug: 'b1', publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(b.id, { ...ready, slug: 'b-hidden', private: true })
    await createEpisode(unfollowed.id, { ...ready, slug: 'c1' })
    const listener = await createUser()
    await setShowFollow(listener.id, a.id, true)
    await setShowFollow(listener.id, b.id, true)
    expect((await listFollowingEpisodes(listener.id, page)).map((e) => e.slug)).toEqual(['b1', 'a1'])
  })
})

describe('listContinueListening', () => {
  it("lists episodes started but not finished, most recently played first", async () => {
    const { show } = await makeShow()
    const listener = await createUser()
    const episode = (slug: string) => createEpisode(show.id, { ...ready, slug, durationSeconds: 600 })
    const older = await episode('older')
    const newer = await episode('newer')
    const finished = await episode('finished')
    await savePlaybackPosition(listener.id, older.id, 100)
    await savePlaybackPosition(listener.id, finished.id, 590)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await savePlaybackPosition(listener.id, newer.id, 200)
    const list = await listContinueListening(listener.id)
    expect(list.map((e) => [e.slug, e.positionSeconds])).toEqual([
      ['newer', 200],
      ['older', 100],
    ])
  })
})

describe('explore', () => {
  it('lists public shows with listed episodes, most recently updated first', async () => {
    const { show: old } = await makeShow('old')
    const { show: recent } = await makeShow('recent')
    const { show: secret } = await makeShow('secret', { private: true })
    const { show: empty } = await makeShow('empty')
    await createEpisode(old.id, { ...ready, publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(recent.id, { ...ready, publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(recent.id, { ...ready, publishedAt: new Date('2025-02-01T00:00:00Z') })
    await createEpisode(secret.id, ready)
    await createEpisode(empty.id, { ...ready, private: true })
    const shows = await listExploreShows(null, page)
    expect(shows.map((p) => p.slug)).toEqual(['recent', 'old'])
    expect(shows[0]).toMatchObject({ episodeCount: 2, latestAt: new Date('2026-02-01T00:00:00Z'), following: false })
    expect(await countExploreShows()).toBe(2)
  })

  it('lists the newest public episodes across the site', async () => {
    const { show } = await makeShow()
    const { show: secret } = await makeShow('secret', { private: true })
    await createEpisode(show.id, { ...ready, slug: 'older', publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(show.id, { ...ready, slug: 'newer', publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(show.id, { ...ready, slug: 'hidden', private: true })
    await createEpisode(secret.id, { ...ready, slug: 'secret-ep' })
    expect((await listLatestEpisodes(null, page)).map((e) => e.slug)).toEqual(['newer', 'older'])
  })

  it('lists the most liked public episodes of the last month', async () => {
    const { show } = await makeShow()
    const { owner: secretOwner, show: secret } = await makeShow('secret', { private: true })
    const one = await createEpisode(show.id, { ...ready, slug: 'one' })
    const two = await createEpisode(show.id, { ...ready, slug: 'two' })
    const stale = await createEpisode(show.id, { ...ready, slug: 'stale' })
    await createEpisode(show.id, { ...ready, slug: 'unliked' })
    const [ann, bob] = [await createUser(), await createUser()]
    await setEpisodeLike(ann.id, one.id, true)
    await setEpisodeLike(ann.id, two.id, true)
    await setEpisodeLike(bob.id, two.id, true)
    await setEpisodeLike(ann.id, stale.id, true)
    await db.update(episodeLikes).set({ createdAt: new Date('2020-01-01') }).where(eq(episodeLikes.episodeId, stale.id))
    // Liked by its owner, but private.
    const hidden = await createEpisode(secret.id, ready)
    await setEpisodeLike(secretOwner.id, hidden.id, true)
    expect((await listPopularEpisodes(null)).map((e) => [e.slug, e.likeCount])).toEqual([
      ['two', 2],
      ['one', 1],
    ])
  })
})
