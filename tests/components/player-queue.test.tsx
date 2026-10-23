// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer, type PlayerEpisode, type PlayerQueue } from '~/components/player/player-provider'

vi.mock('~/functions/podcasts', () => ({ saveMyPlaybackPosition: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/lib/activity', () => ({ reportActivity: vi.fn(), reportTrackedLinkVisit: vi.fn() }))

beforeAll(() => {
  // happy-dom doesn't play audio.
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  HTMLMediaElement.prototype.pause = vi.fn()
})
afterEach(cleanup)

const episode = (id: string): PlayerEpisode => ({
  id,
  title: `Episode ${id}`,
  audioUrl: `/audio/${id}.mp3`,
  imageUrl: null,
  podcastTitle: 'The Show',
  positionSeconds: null,
})
const playlist: PlayerQueue = { title: 'Road trip', href: '/u/ann/playlists/road-trip', episodes: ['a', 'b', 'c'].map(episode) }

let player: ReturnType<typeof usePlayer>
function Probe() {
  player = usePlayer()
  return (
    <p>
      {player.episode?.id ?? 'none'} {player.queue ? `${player.queue.index + 1}/${player.queue.length}` : 'no queue'}
    </p>
  )
}

function setUp() {
  render(
    <PlayerProvider signedIn={false}>
      <Probe />
    </PlayerProvider>,
  )
  return document.querySelector('audio')!
}

describe('playing through a queue', () => {
  it('moves on when an episode ends, and steps back and forth', () => {
    const audio = setUp()
    act(() => player.playQueue(playlist, 1))
    expect(screen.getByText('b 2/3')).toBeTruthy()

    fireEvent(audio, new Event('ended'))
    expect(screen.getByText('c 3/3')).toBeTruthy()
    // The end of the queue: nothing further.
    fireEvent(audio, new Event('ended'))
    expect(screen.getByText('c 3/3')).toBeTruthy()

    act(() => player.previous())
    act(() => player.previous())
    expect(screen.getByText('a 1/3')).toBeTruthy()
    act(() => player.next())
    expect(screen.getByText('b 2/3')).toBeTruthy()
  })

  it('ends when something outside it is played, but not when one of its episodes is', () => {
    setUp()
    act(() => player.playQueue(playlist))
    act(() => player.play(playlist.episodes[2]!))
    expect(screen.getByText('c 3/3')).toBeTruthy()
    act(() => player.play(episode('other')))
    expect(screen.getByText('other no queue')).toBeTruthy()
  })

  it('ends when the player is closed', () => {
    setUp()
    act(() => player.playQueue(playlist))
    act(() => player.close())
    expect(screen.getByText('none no queue')).toBeTruthy()
  })
})
