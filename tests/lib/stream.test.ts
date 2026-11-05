// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EpisodeSource, hlsEntryPath } from '~/lib/stream'

const episode = { id: 'e1', audioUrl: '/api/episodes/e1/audio' }

function audioElement({ nativeHls }: { nativeHls: boolean }) {
  const audio = document.createElement('audio')
  vi.spyOn(audio, 'canPlayType').mockImplementation((type) => (nativeHls && type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''))
  vi.spyOn(audio, 'play').mockResolvedValue()
  vi.spyOn(audio, 'load').mockImplementation(() => {})
  return audio
}

afterEach(() => vi.restoreAllMocks())

describe('EpisodeSource', () => {
  it('gives a browser that plays HLS itself the stream', () => {
    const audio = audioElement({ nativeHls: true })
    new EpisodeSource(audio).load(episode, { autoplay: true })
    expect(audio.getAttribute('src')).toBe(hlsEntryPath('e1'))
    expect(audio.play).toHaveBeenCalled()
  })

  it('falls back to the MP3 from where the stream had got to when it fails', () => {
    const audio = audioElement({ nativeHls: true })
    const source = new EpisodeSource(audio)
    const onFallback = vi.fn()
    source.load(episode, { autoplay: false, startAt: 42, onFallback })
    expect(source.handleError()).toBe(true)
    expect(onFallback).toHaveBeenCalledWith(42)
    expect(audio.getAttribute('src')).toBe(episode.audioUrl)
    // Only the stream falls back: the MP3 failing is the caller's to handle.
    expect(source.handleError()).toBe(false)
  })

  it('plays the MP3 where the browser can play neither HLS nor Media Source', () => {
    const audio = audioElement({ nativeHls: false })
    const source = new EpisodeSource(audio)
    source.load(episode, { autoplay: true })
    expect(audio.getAttribute('src')).toBe(episode.audioUrl)
    expect(source.handleError()).toBe(false)
  })

  it('empties the element when unloaded', () => {
    const audio = audioElement({ nativeHls: true })
    const source = new EpisodeSource(audio)
    source.load(episode, { autoplay: false })
    source.unload()
    expect(audio.hasAttribute('src')).toBe(false)
    expect(source.handleError()).toBe(false)
  })
})
