import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodeLikes, podcasts } from '~/server/db/schema'
import { getPublicEpisode, listPublishedEpisodes, savePlaybackPosition } from '~/server/episodes.server'
import {
  countExplorePodcasts,
  countFollowers,
  countLikedEpisodes,
  listContinueListening,
  listExplorePodcasts,
  listFollowedPodcasts,
  listFollowingEpisodes,
  listLatestEpisodes,
  listLikedEpisodes,
  listPopularEpisodes,
  setEpisodeLike,
  setPodcastFollow,
} from '~/server/library.server'
import { getPublicPodcast } from '~/server/podcasts.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }
const page = { offset: 0, limit: 50 }

async function show(slug = 'show', values: Parameters<typeof createPodcast>[1] = {}) {
  const owner = await createUser({ name: 'Ada' })
  const podcast = await createPodcast(owner.id, { slug, title: slug, ...values })
  return { owner, podcast }
}

describe('setEpisodeLike', () => {
  it('likes and unlikes, counting everyone who likes it', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const [ann, bob] = [await createUser(), await createUser()]
    expect(await setEpisodeLike(ann.id, episode.id, true)).toEqual({ liked: true, likeCount: 1 })
    // Liking twice is the same as once.
    expect(await setEpisodeLike(ann.id, episode.id, true)).toEqual({ liked: true, likeCount: 1 })
    expect(await setEpisodeLike(bob.id, episode.id, true)).toEqual({ liked: true, likeCount: 2 })
    expect(await setEpisodeLike(ann.id, episode.id, false)).toEqual({ liked: false, likeCount: 1 })
  })

  it("won't like what the user can't see", async () => {
    const { owner, podcast } = await show()
    const hidden = await createEpisode(podcast.id, { ...ready, private: true })
    const pending = await createEpisode(podcast.id, { status: 'pending' })
    const listener = await createUser()
    expect(await setEpisodeLike(listener.id, hidden.id, true)).toBeNull()
    expect(await setEpisodeLike(listener.id, pending.id, true)).toBeNull()
    expect(await setEpisodeLike(listener.id, 'missing', true)).toBeNull()
    // Owners can like their own private episodes.
    expect(await setEpisodeLike(owner.id, hidden.id, true)).toEqual({ liked: true, likeCount: 1 })
  })

  it('shows on the public episode list and page, with whether the listener likes it', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, { ...ready, slug: 'ep' })
    const listener = await createUser()
    await setEpisodeLike(listener.id, episode.id, true)
    await setEpisodeLike((await createUser()).id, episode.id, true)
    expect(await listPublishedEpisodes(podcast.id, listener.id)).toMatchObject([{ likeCount: 2, liked: true }])
    expect(await listPublishedEpisodes(podcast.id, null)).toMatchObject([{ likeCount: 2, liked: false }])
    expect((await getPublicEpisode('show', 'ep', listener.id))!.episode).toMatchObject({ likeCount: 2, liked: true })
  })
})

describe('listLikedEpisodes', () => {
  it('lists what the user likes, most recently liked first, with its podcast', async () => {
    const { owner, podcast } = await show()
    const first = await createEpisode(podcast.id, { ...ready, slug: 'first' })
    const second = await createEpisode(podcast.id, { ...ready, slug: 'second' })
    await createEpisode(podcast.id, { ...ready, slug: 'not-liked' })
    const listener = await createUser()
    await setEpisodeLike(listener.id, first.id, true)
    await setEpisodeLike(listener.id, second.id, true)
    await db.update(episodeLikes).set({ createdAt: new Date('2026-01-01') }).where(eq(episodeLikes.episodeId, first.id))
    const liked = await listLikedEpisodes(listener.id, page)
    expect(liked.map((e) => e.slug)).toEqual(['second', 'first'])
    expect(liked[0]).toMatchObject({ liked: true, likeCount: 1, podcast: { slug: 'show', title: 'show', isOwner: false } })
    expect(liked[0]!.podcast).not.toHaveProperty('userId')
    expect(await countLikedEpisodes(listener.id)).toBe(2)
    expect((await listLikedEpisodes(owner.id, page)).length).toBe(0)
  })

  it('leaves out episodes since made private', async () => {
    const { podcast } = await show()
    const episode = await createEpisode(podcast.id, ready)
    const listener = await createUser()
    await setEpisodeLike(listener.id, episode.id, true)
    await db.update(podcasts).set({ private: true }).where(eq(podcasts.id, podcast.id))
    expect(await listLikedEpisodes(listener.id, page)).toEqual([])
    expect(await countLikedEpisodes(listener.id)).toBe(0)
  })
})

describe('follows', () => {
  it('follows and unfollows, counting followers', async () => {
    const { podcast } = await show()
    const [ann, bob] = [await createUser(), await createUser()]
    expect(await setPodcastFollow(ann.id, podcast.id, true)).toEqual({ following: true, followerCount: 1 })
    expect(await setPodcastFollow(ann.id, podcast.id, true)).toEqual({ following: true, followerCount: 1 })
    expect(await setPodcastFollow(bob.id, podcast.id, true)).toEqual({ following: true, followerCount: 2 })
    expect(await setPodcastFollow(ann.id, podcast.id, false)).toEqual({ following: false, followerCount: 1 })
    expect(await countFollowers(podcast.id)).toBe(1)
  })

  it("won't follow someone else's private podcast", async () => {
    const { podcast } = await show('secret', { private: true })
    expect(await setPodcastFollow((await createUser()).id, podcast.id, true)).toBeNull()
    expect(await setPodcastFollow((await createUser()).id, 'missing', true)).toBeNull()
  })

  it('shows on the public podcast page', async () => {
    const { podcast } = await show()
    const listener = await createUser()
    await setPodcastFollow(listener.id, podcast.id, true)
    expect(await getPublicPodcast('show', listener.id)).toMatchObject({ followerCount: 1, following: true })
    expect(await getPublicPodcast('show', null)).toMatchObject({ followerCount: 1, following: false })
  })

  it("lists followed podcasts by title, even empty ones, but not ones made private since", async () => {
    const { podcast: zed } = await show('zed')
    const { podcast: abc } = await show('abc')
    const { podcast: gone } = await show('gone')
    await createEpisode(zed.id, { ...ready, publishedAt: new Date('2026-03-01T00:00:00Z') })
    await createEpisode(zed.id, ready)
    const listener = await createUser()
    for (const p of [zed, abc, gone]) await setPodcastFollow(listener.id, p.id, true)
    await db.update(podcasts).set({ private: true }).where(eq(podcasts.id, gone.id))
    const followed = await listFollowedPodcasts(listener.id)
    expect(followed.map((p) => p.slug)).toEqual(['abc', 'zed'])
    expect(followed[0]).toMatchObject({ episodeCount: 0, latestAt: null, following: true, followerCount: 1, author: 'Ada' })
    expect(followed[1]).toMatchObject({ episodeCount: 2 })
  })

  it("lists followed podcasts' listed episodes, newest first", async () => {
    const { podcast: a } = await show('a')
    const { podcast: b } = await show('b')
    const { podcast: unfollowed } = await show('c')
    await createEpisode(a.id, { ...ready, slug: 'a1', publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(b.id, { ...ready, slug: 'b1', publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(b.id, { ...ready, slug: 'b-hidden', private: true })
    await createEpisode(unfollowed.id, { ...ready, slug: 'c1' })
    const listener = await createUser()
    await setPodcastFollow(listener.id, a.id, true)
    await setPodcastFollow(listener.id, b.id, true)
    expect((await listFollowingEpisodes(listener.id, page)).map((e) => e.slug)).toEqual(['b1', 'a1'])
  })
})

describe('listContinueListening', () => {
  it("lists episodes started but not finished, most recently played first", async () => {
    const { podcast } = await show()
    const listener = await createUser()
    const episode = (slug: string) => createEpisode(podcast.id, { ...ready, slug, durationSeconds: 600 })
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
  it('lists public podcasts with listed episodes, most recently updated first', async () => {
    const { podcast: old } = await show('old')
    const { podcast: recent } = await show('recent')
    const { podcast: secret } = await show('secret', { private: true })
    const { podcast: empty } = await show('empty')
    await createEpisode(old.id, { ...ready, publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(recent.id, { ...ready, publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(recent.id, { ...ready, publishedAt: new Date('2025-02-01T00:00:00Z') })
    await createEpisode(secret.id, ready)
    await createEpisode(empty.id, { ...ready, private: true })
    const shows = await listExplorePodcasts(null, page)
    expect(shows.map((p) => p.slug)).toEqual(['recent', 'old'])
    expect(shows[0]).toMatchObject({ episodeCount: 2, latestAt: new Date('2026-02-01T00:00:00Z'), following: false })
    expect(await countExplorePodcasts()).toBe(2)
  })

  it('lists the newest public episodes across the site', async () => {
    const { podcast } = await show()
    const { podcast: secret } = await show('secret', { private: true })
    await createEpisode(podcast.id, { ...ready, slug: 'older', publishedAt: new Date('2026-01-01T00:00:00Z') })
    await createEpisode(podcast.id, { ...ready, slug: 'newer', publishedAt: new Date('2026-02-01T00:00:00Z') })
    await createEpisode(podcast.id, { ...ready, slug: 'hidden', private: true })
    await createEpisode(secret.id, { ...ready, slug: 'secret-ep' })
    expect((await listLatestEpisodes(null, page)).map((e) => e.slug)).toEqual(['newer', 'older'])
  })

  it('lists the most liked public episodes of the last month', async () => {
    const { podcast } = await show()
    const { owner: secretOwner, podcast: secret } = await show('secret', { private: true })
    const one = await createEpisode(podcast.id, { ...ready, slug: 'one' })
    const two = await createEpisode(podcast.id, { ...ready, slug: 'two' })
    const stale = await createEpisode(podcast.id, { ...ready, slug: 'stale' })
    await createEpisode(podcast.id, { ...ready, slug: 'unliked' })
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
