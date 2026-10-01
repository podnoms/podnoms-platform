// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Waveform } from '~/components/player/waveform'

// Reports a fixed width, as the browser would once the element is laid out.
class FixedResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect() {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', FixedResizeObserver))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderWaveform(props: { position?: number; duration?: number; values?: number[] } = {}) {
  const onSeek = vi.fn()
  render(
    <Waveform values={props.values ?? Array(1000).fill(128)} duration={props.duration ?? 600} position={props.position ?? 100} onSeek={onSeek} />,
  )
  return { onSeek, slider: screen.getByRole('slider') }
}

describe('Waveform', () => {
  it('describes the position for assistive technology', () => {
    const { slider } = renderWaveform({ position: 65.4, duration: 3600 })
    expect(slider.getAttribute('aria-valuenow')).toBe('65')
    expect(slider.getAttribute('aria-valuemax')).toBe('3600')
    expect(slider.getAttribute('aria-valuetext')).toBe('1:05 of 1:00:00')
  })

  it('draws as many bars as fit the width', () => {
    const { slider } = renderWaveform()
    const upper = slider.querySelector('path')!.getAttribute('d')!
    // 4px per bar (3px wide, 1px gap) across 400px.
    expect(upper.match(/M/g)).toHaveLength(100)
  })

  it('draws every bar when there are fewer than fit', () => {
    const { slider } = renderWaveform({ values: [0, 255, 128] })
    expect(slider.querySelector('path')!.getAttribute('d')!.match(/M/g)).toHaveLength(3)
  })

  it.each([
    ['ArrowRight', 105],
    ['ArrowUp', 105],
    ['ArrowLeft', 95],
    ['ArrowDown', 95],
    ['PageUp', 130],
    ['PageDown', 70],
    ['Home', 0],
    ['End', 600],
  ])('seeks with %s', (key, target) => {
    const { onSeek, slider } = renderWaveform()
    fireEvent.keyDown(slider, { key })
    expect(onSeek).toHaveBeenCalledWith(target)
  })

  it('keeps keyboard seeking within the episode', () => {
    const start = renderWaveform({ position: 2 })
    fireEvent.keyDown(start.slider, { key: 'PageDown' })
    expect(start.onSeek).toHaveBeenCalledWith(0)
    cleanup()
    const end = renderWaveform({ position: 590 })
    fireEvent.keyDown(end.slider, { key: 'PageUp' })
    expect(end.onSeek).toHaveBeenCalledWith(600)
  })

  it('ignores other keys, and all keys before the duration is known', () => {
    const { onSeek, slider } = renderWaveform()
    fireEvent.keyDown(slider, { key: 'a' })
    cleanup()
    const unknown = renderWaveform({ duration: 0 })
    fireEvent.keyDown(unknown.slider, { key: 'ArrowRight' })
    expect(onSeek).not.toHaveBeenCalled()
    expect(unknown.onSeek).not.toHaveBeenCalled()
  })
})
