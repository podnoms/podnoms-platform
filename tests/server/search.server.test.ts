import { beforeEach, describe, expect, it } from 'vitest'
import { searchLibrary } from '~/server/search.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

describe('searchLibrary', () => {
  it('finds podcasts and episodes by title, ignoring case', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Deep House Sessions', slug: 'deep-house' })
    const episode = await createEpisode(podcast.id, { title: 'Late Night HOUSE Mix', slug: 'late-night' })
    await createEpisode(podcast.id, { title: 'Techno Hour' })

    expect(await searchLibrary(user.id, 'house')).toEqual({
      podcasts: [{ id: podcast.id, title: 'Deep House Sessions', slug: 'deep-house', imageUrl: null, excerpt: null }],
      episodes: [
        {
          id: episode.id,
          title: 'Late Night HOUSE Mix',
          slug: 'late-night',
          imageUrl: null,
          podcastTitle: 'Deep House Sessions',
          podcastSlug: 'deep-house',
          excerpt: null,
        },
      ],
    })
  })

  it('matches the text of descriptions, not their HTML, with an excerpt', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show' })
    await createEpisode(podcast.id, { title: 'One', description: '<p>Recorded <strong>live</strong> at the Button Factory</p>' })
    await createEpisode(podcast.id, { title: 'Two', description: '<p>Nothing to see</p>' })

    const { episodes } = await searchLibrary(user.id, 'button factory')
    expect(episodes.map((episode) => [episode.title, episode.excerpt])).toEqual([['One', 'Recorded live at the Button Factory']])
    expect((await searchLibrary(user.id, 'strong')).episodes).toEqual([])
  })

  it('shortens long excerpts around the match', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { description: `<p>${'a '.repeat(100)}needle${' b'.repeat(100)}</p>` })
    const [found] = (await searchLibrary(user.id, 'needle')).podcasts
    expect(found!.excerpt).toMatch(/^…a a .*needle b b .*…$/)
    expect(found!.excerpt!.length).toBeLessThan(140)
    expect(found!.id).toBe(podcast.id)
  })

  it('lists title matches before description matches', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show' })
    await createEpisode(podcast.id, { title: 'Older', description: 'About jazz', createdAt: new Date('2025-01-02') })
    await createEpisode(podcast.id, { title: 'Jazz night', createdAt: new Date('2025-01-01') })
    await createEpisode(podcast.id, { title: 'Newer', description: 'More jazz', createdAt: new Date('2025-01-03') })

    expect((await searchLibrary(user.id, 'jazz')).episodes.map((episode) => episode.title)).toEqual(['Jazz night', 'Newer', 'Older'])
  })

  it("only searches the user's own podcasts and episodes", async () => {
    const other = await createPodcast((await createUser()).id, { title: 'Secret show' })
    await createEpisode(other.id, { title: 'Secret episode' })
    expect(await searchLibrary((await createUser()).id, 'secret')).toEqual({ podcasts: [], episodes: [] })
  })

  it('takes LIKE wildcards literally', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: '100% Hits' })
    await createEpisode(podcast.id, { title: 'snake_case' })
    await createEpisode(podcast.id, { title: 'snakeXcase' })

    expect((await searchLibrary(user.id, '%')).podcasts.map((p) => p.title)).toEqual(['100% Hits'])
    expect((await searchLibrary(user.id, 'snake_')).episodes.map((e) => e.title)).toEqual(['snake_case'])
  })

  it("uses the podcast's artwork for an episode without its own", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'Show', imageUrl: '/images/show.jpg' })
    await createEpisode(podcast.id, { title: 'Plain' })
    await createEpisode(podcast.id, { title: 'Pictured', imageUrl: '/images/own.jpg' })

    const { episodes } = await searchLibrary(user.id, 'p')
    expect(Object.fromEntries(episodes.map((e) => [e.title, e.imageUrl]))).toEqual({
      Plain: '/images/show.jpg',
      Pictured: '/images/own.jpg',
    })
  })
})
