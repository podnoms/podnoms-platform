// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { readLastEpisode, storeLastEpisode, type LastEpisode } from '~/lib/last-episode'

const episode: LastEpisode = {
  id: 'ep-1',
  title: 'Episode One',
  audioUrl: '/api/episodes/ep-1/audio',
  imageUrl: null,
  podcastTitle: 'The Show',
  positionSeconds: 42,
}

beforeEach(() => localStorage.clear())

describe('readLastEpisode', () => {
  it('is null when nothing was stored', () => {
    expect(readLastEpisode()).toBeNull()
  })

  it('reads back what was stored', () => {
    storeLastEpisode(episode)
    expect(readLastEpisode()).toEqual(episode)
  })

  it('forgets the episode when stored as null', () => {
    storeLastEpisode(episode)
    storeLastEpisode(null)
    expect(readLastEpisode()).toBeNull()
  })

  it('ignores junk and episodes missing fields', () => {
    for (const junk of ['not json', '"ep-1"', JSON.stringify({ id: 'ep-1', title: 'T' })]) {
      localStorage.setItem('player-episode', junk)
      expect(readLastEpisode()).toBeNull()
    }
  })
})
