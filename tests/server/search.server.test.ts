import { beforeEach, describe, expect, it } from 'vitest'
import { searchLibrary } from '~/server/search.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

describe('searchLibrary', () => {
  it('finds shows and episodes by title, ignoring case', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'Deep House Sessions', slug: 'deep-house' })
    const episode = await createEpisode(show.id, { title: 'Late Night HOUSE Mix', slug: 'late-night' })
    await createEpisode(show.id, { title: 'Techno Hour' })

    expect(await searchLibrary(user.id, 'house')).toEqual({
      shows: [{ id: show.id, title: 'Deep House Sessions', slug: 'deep-house', imageUrl: null, excerpt: null }],
      episodes: [
        {
          id: episode.id,
          title: 'Late Night HOUSE Mix',
          slug: 'late-night',
          imageUrl: null,
          showTitle: 'Deep House Sessions',
          showSlug: 'deep-house',
          ready: false,
          excerpt: null,
        },
      ],
    })
  })

  it('says which episodes have a public page yet', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    await createEpisode(show.id, { title: 'Ready mix', status: 'ready', audioUrl: '/a' })
    await createEpisode(show.id, { title: 'Pending mix' })
    const { episodes } = await searchLibrary(user.id, 'mix')
    expect(Object.fromEntries(episodes.map((episode) => [episode.title, episode.ready]))).toEqual({
      'Ready mix': true,
      'Pending mix': false,
    })
  })

  it('matches the text of descriptions, not their HTML, with an excerpt', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'Show' })
    await createEpisode(show.id, { title: 'One', description: '<p>Recorded <strong>live</strong> at the Button Factory</p>' })
    await createEpisode(show.id, { title: 'Two', description: '<p>Nothing to see</p>' })

    const { episodes } = await searchLibrary(user.id, 'button factory')
    expect(episodes.map((episode) => [episode.title, episode.excerpt])).toEqual([['One', 'Recorded live at the Button Factory']])
    expect((await searchLibrary(user.id, 'strong')).episodes).toEqual([])
  })

  it('shortens long excerpts around the match', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { description: `<p>${'a '.repeat(100)}needle${' b'.repeat(100)}</p>` })
    const [found] = (await searchLibrary(user.id, 'needle')).shows
    expect(found!.excerpt).toMatch(/^…a a .*needle b b .*…$/)
    expect(found!.excerpt!.length).toBeLessThan(140)
    expect(found!.id).toBe(show.id)
  })

  it('lists title matches before description matches', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'Show' })
    await createEpisode(show.id, { title: 'Older', description: 'About jazz', createdAt: new Date('2025-01-02') })
    await createEpisode(show.id, { title: 'Jazz night', createdAt: new Date('2025-01-01') })
    await createEpisode(show.id, { title: 'Newer', description: 'More jazz', createdAt: new Date('2025-01-03') })

    expect((await searchLibrary(user.id, 'jazz')).episodes.map((episode) => episode.title)).toEqual(['Jazz night', 'Newer', 'Older'])
  })

  it("only searches the user's own shows and episodes", async () => {
    const other = await createShow((await createUser()).id, { title: 'Secret show' })
    await createEpisode(other.id, { title: 'Secret episode' })
    expect(await searchLibrary((await createUser()).id, 'secret')).toEqual({ shows: [], episodes: [] })
  })

  it('takes LIKE wildcards literally', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: '100% Hits' })
    await createEpisode(show.id, { title: 'snake_case' })
    await createEpisode(show.id, { title: 'snakeXcase' })

    expect((await searchLibrary(user.id, '%')).shows.map((p) => p.title)).toEqual(['100% Hits'])
    expect((await searchLibrary(user.id, 'snake_')).episodes.map((e) => e.title)).toEqual(['snake_case'])
  })

  it("uses the show's artwork for an episode without its own", async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'Show', imageUrl: '/images/show.jpg' })
    await createEpisode(show.id, { title: 'Plain' })
    await createEpisode(show.id, { title: 'Pictured', imageUrl: '/images/own.jpg' })

    const { episodes } = await searchLibrary(user.id, 'p')
    expect(Object.fromEntries(episodes.map((e) => [e.title, e.imageUrl]))).toEqual({
      Plain: '/images/show.jpg',
      Pictured: '/images/own.jpg',
    })
  })
})
