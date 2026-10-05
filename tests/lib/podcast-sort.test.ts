import { describe, expect, it } from 'vitest'
import { sortPodcasts } from '~/lib/podcast-sort'

const podcast = (title: string, createdAt: string, latestEpisodeAt: string | null) => ({
  title,
  createdAt: new Date(createdAt),
  latestEpisodeAt: latestEpisodeAt ? new Date(latestEpisodeAt) : null,
})

const podcasts = [
  podcast('banjo', '2026-01-01', '2026-05-01'),
  podcast('Aardvark', '2026-03-01', null),
  podcast('Cello', '2026-02-01', '2026-06-01'),
  podcast('Drums', '2026-02-01', null),
]
const titles = (list: { title: string }[]) => list.map((p) => p.title)

describe('sortPodcasts', () => {
  it('sorts by title, ignoring case', () => {
    expect(titles(sortPodcasts(podcasts, 'title'))).toEqual(['Aardvark', 'banjo', 'Cello', 'Drums'])
  })

  it('puts the newest podcasts first, ties by title', () => {
    expect(titles(sortPodcasts(podcasts, 'latest'))).toEqual(['Aardvark', 'Cello', 'Drums', 'banjo'])
  })

  it('puts podcasts with the latest episodes first, and those with none last', () => {
    expect(titles(sortPodcasts(podcasts, 'latest-episode'))).toEqual(['Cello', 'banjo', 'Aardvark', 'Drums'])
  })

  it('leaves the list it was given alone', () => {
    sortPodcasts(podcasts, 'title')
    expect(podcasts[0]!.title).toBe('banjo')
  })
})
