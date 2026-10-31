import { describe, expect, it } from 'vitest'
import { sortShows } from '~/lib/show-sort'

const show = (title: string, createdAt: string, latestEpisodeAt: string | null) => ({
  title,
  createdAt: new Date(createdAt),
  latestEpisodeAt: latestEpisodeAt ? new Date(latestEpisodeAt) : null,
})

const shows = [
  show('banjo', '2026-01-01', '2026-05-01'),
  show('Aardvark', '2026-03-01', null),
  show('Cello', '2026-02-01', '2026-06-01'),
  show('Drums', '2026-02-01', null),
]
const titles = (list: { title: string }[]) => list.map((p) => p.title)

describe('sortShows', () => {
  it('sorts by title, ignoring case', () => {
    expect(titles(sortShows(shows, 'title'))).toEqual(['Aardvark', 'banjo', 'Cello', 'Drums'])
  })

  it('puts the newest shows first, ties by title', () => {
    expect(titles(sortShows(shows, 'latest'))).toEqual(['Aardvark', 'Cello', 'Drums', 'banjo'])
  })

  it('puts shows with the latest episodes first, and those with none last', () => {
    expect(titles(sortShows(shows, 'latest-episode'))).toEqual(['Cello', 'banjo', 'Aardvark', 'Drums'])
  })

  it('leaves the list it was given alone', () => {
    sortShows(shows, 'title')
    expect(shows[0]!.title).toBe('banjo')
  })
})
