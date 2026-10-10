// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayer, type PlayerEpisode } from '~/components/player/player-provider'
import { saveMyPlaybackPosition } from '~/functions/podcasts'

vi.mock('~/functions/podcasts', () => ({ saveMyPlaybackPosition: vi.fn(() => Promise.resolve()) }))
// Playing reports a play for the podcast's stats; not from tests.
vi.mock('~/lib/activity', () => ({ reportActivity: vi.fn() }))

const episode = (id: string): PlayerEpisode => ({
  id,
  title: id,
  audioUrl: `/api/episodes/${id}/audio`,
  imageUrl: null,
  podcastTitle: 'Show',
  slug: id,
  podcastSlug: 'show',
  positionSeconds: null,
})

function renderPlayer() {
  let player!: ReturnType<typeof usePlayer>
  function Grab() {
    player = usePlayer()
    return null
  }
  render(
    <PlayerProvider signedIn={false}>
      <Grab />
    </PlayerProvider>,
  )
  return () => player
}

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

  // The position shown (e.g. on the waveform) used to spring back to where it
  // was until the audio caught up, then jump forward again.
  it('shows a seek at once, before the audio catches up', () => {
    const player = renderPlayer()
    act(() => player().play(episode('one')))
    act(() => player().seek(120))
    expect(player().currentTime).toBe(120)
  })

  it('shows where a new episode will start, not 0, while it loads', () => {
    const player = renderPlayer()
    act(() => player().play(episode('one'), { startAt: 300 }))
    expect(player().currentTime).toBe(300)
  })

  describe('arrow keys', () => {
    // A loaded, playing episode ten minutes long, a minute in.
    function playing() {
      const player = renderPlayer()
      act(() => player().play(episode('one')))
      const audio = document.querySelector('audio')!
      Object.defineProperty(audio, 'duration', { configurable: true, value: 600 })
      act(() => {
        audio.currentTime = 60
        audio.dispatchEvent(new Event('play'))
      })
      return { player, audio }
    }

    const press = (key: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
      })

    it('skip back and forward 20 seconds while playing, on any page', () => {
      const { player, audio } = playing()
      press('ArrowRight')
      expect(audio.currentTime).toBe(80)
      expect(player().currentTime).toBe(80)
      press('ArrowLeft')
      press('ArrowLeft')
      expect(audio.currentTime).toBe(40)
    })

    it("don't go past the start", () => {
      const { audio } = playing()
      press('ArrowLeft')
      press('ArrowLeft')
      press('ArrowLeft')
      press('ArrowLeft')
      expect(audio.currentTime).toBe(0)
    })

    it('do nothing while paused', () => {
      const { audio } = playing()
      act(() => {
        audio.dispatchEvent(new Event('pause'))
      })
      press('ArrowRight')
      expect(audio.currentTime).toBe(60)
    })

    it('are left to fields, sliders and modified presses', () => {
      const { audio } = playing()
      const input = document.body.appendChild(document.createElement('input'))
      const slider = document.body.appendChild(document.createElement('div'))
      slider.setAttribute('role', 'slider')
      press('ArrowRight', input)
      press('ArrowRight', slider)
      press('ArrowRight', document.body, { shiftKey: true })
      expect(audio.currentTime).toBe(60)
      input.remove()
      slider.remove()
    })
  })
})
