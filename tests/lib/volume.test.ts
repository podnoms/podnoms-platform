// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultVolume, readStoredVolume, storeVolume } from '~/lib/volume'

beforeEach(() => localStorage.clear())

describe('readStoredVolume', () => {
  it('defaults to full volume, unmuted', () => {
    expect(readStoredVolume()).toEqual(defaultVolume)
  })

  it('reads back what was stored', () => {
    storeVolume({ level: 0.3, muted: true })
    expect(readStoredVolume()).toEqual({ level: 0.3, muted: true })
  })

  it('clamps the level between 0 and 1', () => {
    localStorage.setItem('player-volume', JSON.stringify({ level: 4, muted: false }))
    expect(readStoredVolume().level).toBe(1)
    localStorage.setItem('player-volume', JSON.stringify({ level: -1, muted: false }))
    expect(readStoredVolume().level).toBe(0)
  })

  it('ignores junk', () => {
    for (const junk of ['not json', '"loud"', '{"level":"high"}', 'null']) {
      localStorage.setItem('player-volume', junk)
      expect(readStoredVolume()).toEqual(defaultVolume)
    }
  })
})
