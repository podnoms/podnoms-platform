// Excluding a user (setUserExcluded): everything of theirs that others could
// find is hidden from everyone but them, while their feeds and custom domains
// keep working.
import type { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ShowRef } from '~/lib/paths'
import { getAdminOverview, setUserExcluded } from '~/server/admin.server'
import { episodeTags, tags } from '~/server/db/schema'
import { getPublicEpisode } from '~/server/episodes.server'
import { buildShowFeed } from '~/server/feed.server'
import {
  countExploreShows,
  listExploreShows,
  listFollowedShows,
  listLatestEpisodes,
  listTrendingShows,
  listUserShows,
  setShowFollow,
} from '~/server/library.server'
import { getWatchableShow } from '~/server/live.server'
import { addToPlaylist, createPlaylist, getPlaylistPage } from '~/server/playlists.server'
import { getPublicShow } from '~/server/shows.server'
import { listSitemapEntries } from '~/server/sitemap.server'
import { countTagEpisodes } from '~/server/tags.server'
import { getPublicProfile } from '~/server/users.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/audio' }
const page = { offset: 0, limit: 20 }

// An excluded maker with a public show, episode, tag and playlist, and a listener.
async function setUp() {
  const maker = await createUser({ slug: 'maker' })
  const listener = await createUser({ slug: 'listener' })
  const show = await createShow(maker.id, { slug: 'the-show' })
  const episode = await createEpisode(show.id, { slug: 'one', ...ready })
  const [tag] = await db.insert(tags).values({ name: 'Jazz', slug: 'jazz' }).returning()
  await db.insert(episodeTags).values({ episodeId: episode.id, tagId: tag!.id })
  const playlist = await createPlaylist(maker.id, { title: 'Mix', description: null, private: false })
  await addToPlaylist(maker.id, playlist.id, episode.id)
  // Followed before they were excluded.
  await setShowFollow(listener.id, show.id, true)
  expect(await setUserExcluded(maker.id, true)).toBe(true)
  return { maker, listener, show, episode, tag: tag!, ref: { ownerSlug: 'maker', slug: 'the-show' } }
}

describe('an excluded user', () => {
  it('is marked so on the admin page, and can be let back', async () => {
    const { maker, listener } = await setUp()
    const excluded = async () => (await getAdminOverview()).users.find((user) => user.id === maker.id)?.excludedAt
    expect(await excluded()).toBeInstanceOf(Date)
    expect(await getPublicShow({ id: (await createShow(maker.id)).id }, listener.id)).toBeNull()

    expect(await setUserExcluded(maker.id, false)).toBe(true)
    expect(await excluded()).toBeNull()
    expect(await getPublicProfile('maker', listener.id)).not.toBeNull()
  })

  it("can't be an admin", async () => {
    const admin = await createUser({ isAdmin: true })
    expect(await setUserExcluded(admin.id, true)).toBe(false)
  })

  it('is hidden from everyone else, signed in or not', async () => {
    const { listener, show, ref, tag } = await setUp()
    for (const viewer of [listener.id, null]) {
      expect(await getPublicProfile('maker', viewer)).toBeNull()
      expect(await getPublicShow(ref, viewer)).toBeNull()
      expect(await getPublicEpisode(ref, 'one', viewer)).toBeNull()
      expect(await getPlaylistPage('maker', 'mix', viewer)).toBeNull()
      expect(await getWatchableShow(show.id, viewer)).toBeNull()
      expect(await listExploreShows(viewer, page)).toEqual([])
      expect(await listLatestEpisodes(viewer, page)).toEqual([])
    }
    expect(await countExploreShows()).toBe(0)
    expect(await listTrendingShows((await createUser()).id)).toEqual([])
    expect(await countTagEpisodes(tag.id)).toBe(0)
    expect(JSON.stringify(await listSitemapEntries())).not.toContain('maker')
  })

  it("drops out of their followers' lists, and can't be followed", async () => {
    const { listener, show } = await setUp()
    expect(await listFollowedShows(listener.id)).toEqual([])
    expect(await setShowFollow((await createUser()).id, show.id, true)).toBeNull()
  })

  it('still sees all of their own, as before', async () => {
    const { maker, ref } = await setUp()
    expect(await getPublicProfile('maker', maker.id)).toMatchObject({ slug: 'maker' })
    expect(await getPublicShow(ref, maker.id)).toMatchObject({ slug: 'the-show' })
    expect(await getPublicEpisode(ref, 'one', maker.id)).not.toBeNull()
    expect(await getPlaylistPage('maker', 'mix', maker.id)).toMatchObject({ isOwner: true })
    expect(await listUserShows(maker.id, maker.id)).toHaveLength(1)
    expect(await listUserShows(null, maker.id)).toEqual([])
  })

  it('keeps their feeds and their show on its own domain', async () => {
    const { listener, ref } = await setUp()
    expect(await buildShowFeed(ref, 'https://podnoms.test')).toContain('<item>')

    // As handleCustomDomain records the domain's show for the request.
    const requestDomain = (globalThis as { podnomsCustomDomain?: AsyncLocalStorage<ShowRef> }).podnomsCustomDomain!
    const onDomain = (show: ShowRef) =>
      requestDomain.run(show, async () => ({
        show: await getPublicShow(ref, listener.id),
        episode: await getPublicEpisode(ref, 'one', null),
      }))
    expect(await onDomain(ref)).toMatchObject({ show: { slug: 'the-show' }, episode: { episode: { slug: 'one' } } })
    // Only that show: another domain's page doesn't make theirs visible.
    expect(await onDomain({ ownerSlug: 'someone', slug: 'else' })).toEqual({ show: null, episode: null })
  })
})
