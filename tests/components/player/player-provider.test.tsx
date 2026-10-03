// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer, type PlayerEpisode } from '~/components/player/player-provider'
import { saveMyPlaybackPosition } from '~/functions/podcasts'

vi.mock('~/functions/podcasts', () => ({ saveMyPlaybackPosition: vi.fn(() => Promise.resolve()) }))

const episode = (id: string): PlayerEpisode => ({
  id,
  title: id,
  audioUrl: `/api/episodes/${id}/audio`,
  imageUrl: null,
  podcastTitle: 'Show',
  positionSeconds: null,
})

// Plays one episode then another, which saves where the first was left off.
function playTwo(signedIn: boolean) {
  let player!: ReturnType<typeof usePlayer>
  function Grab() {
    player = usePlayer()
    return null
  }
  render(
    <PlayerProvider signedIn={signedIn}>
      <Grab />
    </PlayerProvider>,
  )
  act(() => player.play(episode('one')))
  act(() => player.play(episode('two')))
  return () => player
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.mocked(saveMyPlaybackPosition).mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('PlayerProvider', () => {
  it("saves signed-in listeners' positions on the server", () => {
    playTwo(true)
    expect(saveMyPlaybackPosition).toHaveBeenCalledWith({ data: { episodeId: 'one', seconds: 0 } })
  })

  it("keeps signed-out listeners' positions in the browser only", () => {
    const player = playTwo(false)
    expect(saveMyPlaybackPosition).not.toHaveBeenCalled()
    expect(player().positionOf('one', null)).toBe(0)
    expect(player().episode?.id).toBe('two')
  })
})
