import { afterEach, describe, expect, it } from 'vitest'
import { playOneAtATime } from '~/lib/one-player'

// Enough of a media element for playOneAtATime: playing and pausing fire their
// events, as a browser's do.
class FakeMedia extends EventTarget {
  paused = true
  muted = false
  volume = 1
  play() {
    this.paused = false
    this.dispatchEvent(new Event('play'))
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
  setMuted(muted: boolean) {
    this.muted = muted
    this.dispatchEvent(new Event('volumechange'))
  }
}

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

// A registered element, standing in for a player in a tab of its own.
function player() {
  const media = new FakeMedia()
  cleanups.push(playOneAtATime(media as unknown as HTMLMediaElement))
  return media
}

// BroadcastChannel delivers asynchronously.
const delivered = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('playOneAtATime', () => {
  it('pauses the others when one starts playing', async () => {
    const [first, second, third] = [player(), player(), player()]
    first.play()
    await delivered()
    second.play()
    await delivered()
    expect([first.paused, second.paused, third.paused]).toEqual([true, false, true])
  })

  it("leaves the others alone while one plays muted, until it's unmuted", async () => {
    const [playing, live] = [player(), player()]
    live.muted = true
    live.play()
    await delivered()
    playing.play()
    await delivered()
    expect([playing.paused, live.paused]).toEqual([false, false])

    live.setMuted(false)
    await delivered()
    expect([playing.paused, live.paused]).toEqual([true, false])
  })

  it('stops listening once unregistered', async () => {
    const media = new FakeMedia()
    playOneAtATime(media as unknown as HTMLMediaElement)()
    media.play()
    player().play()
    await delivered()
    expect(media.paused).toBe(false)
  })
})
