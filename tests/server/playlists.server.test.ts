import { beforeEach, describe, expect, it } from 'vitest'
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistPage,
  listMyPlaylists,
  listPublicPlaylists,
  removeFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
} from '~/server/playlists.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const ready = { status: 'ready' as const, audioUrl: '/audio' }
const details = (title: string, isPrivate = true) => ({ title, description: null, private: isPrivate })

async function setUp() {
  const listener = await createUser({ slug: 'ann' })
  const maker = await createUser({ slug: 'maker' })
  const show = await createShow(maker.id, { title: 'The Show', slug: 'the-show' })
  const [one, two, three] = await Promise.all(
    ['One', 'Two', 'Three'].map((title) => createEpisode(show.id, { title, slug: title.toLowerCase(), ...ready })),
  )
  return { listener, maker, show, one: one!, two: two!, three: three! }
}

const titles = (page: Awaited<ReturnType<typeof getPlaylistPage>>) => page?.episodes.map((episode) => episode.title)

describe('playlists', () => {
  it('gives each of a user’s playlists its own slug from its title', async () => {
    const { listener, maker } = await setUp()
    expect((await createPlaylist(listener.id, details('Road Trip!'))).slug).toBe('road-trip')
    expect((await createPlaylist(listener.id, details('Road trip'))).slug).toBe('road-trip-2')
    expect((await createPlaylist(maker.id, details('Road trip'))).slug).toBe('road-trip')
  })

  it('keeps episodes in the order they were added, each once, and reorders them', async () => {
    const { listener, one, two, three } = await setUp()
    const playlist = await createPlaylist(listener.id, details('Mine'))
    for (const episode of [two, one, three, two]) expect(await addToPlaylist(listener.id, playlist.id, episode.id)).toBe(true)
    expect(titles(await getPlaylistPage('ann', 'mine', listener.id))).toEqual(['Two', 'One', 'Three'])

    await reorderPlaylist(listener.id, playlist.id, [three.id, one.id])
    expect(titles(await getPlaylistPage('ann', 'mine', listener.id))).toEqual(['Three', 'One', 'Two'])

    await removeFromPlaylist(listener.id, playlist.id, one.id)
    expect(titles(await getPlaylistPage('ann', 'mine', listener.id))).toEqual(['Three', 'Two'])
  })

  it("only lets the owner change it, and only with episodes they can see", async () => {
    const { listener, maker, show, one } = await setUp()
    const playlist = await createPlaylist(listener.id, details('Mine'))
    const hidden = await createEpisode(show.id, { title: 'Hidden', ...ready, private: true })
    expect(await addToPlaylist(maker.id, playlist.id, one.id)).toBe(false)
    expect(await addToPlaylist(listener.id, playlist.id, hidden.id)).toBe(false)
    expect(await updatePlaylist(maker.id, playlist.id, details('Theirs'))).toBe(false)
    expect(await reorderPlaylist(maker.id, playlist.id, [])).toBe(false)
    expect(await deletePlaylist(maker.id, playlist.id)).toBe(false)
    expect(await deletePlaylist(listener.id, playlist.id)).toBe(true)
  })

  it('shows a private playlist only to its owner, and a public one to anyone', async () => {
    const { listener, maker, one } = await setUp()
    const playlist = await createPlaylist(listener.id, details('Mine'))
    await addToPlaylist(listener.id, playlist.id, one.id)
    expect(await getPlaylistPage('ann', 'mine', null)).toBeNull()
    expect(await getPlaylistPage('ann', 'mine', maker.id)).toBeNull()
    expect(await getPlaylistPage('ANN', 'mine', listener.id)).toMatchObject({ isOwner: true, owner: { slug: 'ann' } })

    await updatePlaylist(listener.id, playlist.id, details('Mine', false))
    expect(await getPlaylistPage('ann', 'mine', null)).toMatchObject({ title: 'Mine', isOwner: false, private: false })
    expect(await listPublicPlaylists(listener.id)).toMatchObject([{ title: 'Mine', slug: 'mine', episodeCount: 1 }])
  })

  it("shows each viewer only the episodes they may see", async () => {
    const { listener, maker, show, one } = await setUp()
    const own = await createEpisode(show.id, { title: 'Owner only', ...ready, private: true })
    const playlist = await createPlaylist(maker.id, details('Mixed', false))
    await addToPlaylist(maker.id, playlist.id, one.id)
    await addToPlaylist(maker.id, playlist.id, own.id)
    expect(titles(await getPlaylistPage('maker', 'mixed', maker.id))).toEqual(['One', 'Owner only'])
    expect(titles(await getPlaylistPage('maker', 'mixed', listener.id))).toEqual(['One'])
    expect(await listPublicPlaylists(maker.id)).toMatchObject([{ episodeCount: 1 }])
  })

  it("lists the user's playlists, saying which have an episode", async () => {
    const { listener, one, two } = await setUp()
    const a = await createPlaylist(listener.id, details('A'))
    await createPlaylist(listener.id, details('B'))
    await addToPlaylist(listener.id, a.id, one.id)
    await addToPlaylist(listener.id, a.id, two.id)
    const mine = await listMyPlaylists(listener.id, one.id)
    expect(Object.fromEntries(mine.map((playlist) => [playlist.title, [playlist.episodeCount, playlist.contains]]))).toEqual({
      A: [2, true],
      B: [0, false],
    })
  })
})
