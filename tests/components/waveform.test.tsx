// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Waveform, waveformSizes } from '~/components/player/waveform'

const width = 400
const { barsHeight } = waveformSizes.default

beforeAll(() => {
  // happy-dom lays nothing out: the waveform is `width` wide, at the top left.
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: width, bottom: 120, width, height: 120, x: 0, y: 0, toJSON: () => ({}) }
  }
  Element.prototype.setPointerCapture ??= () => {}
})
afterEach(cleanup)

const values = Array.from({ length: 100 }, (_, i) => (i * 37) % 255)

function renderWaveform(props: Partial<Parameters<typeof Waveform>[0]> = {}) {
  const onSeek = vi.fn()
  const onComment = vi.fn()
  render(<Waveform values={values} duration={600} position={0} onSeek={onSeek} onComment={onComment} {...props} />)
  return { onSeek, onComment, slider: screen.getByRole('slider') }
}

// A click, from pressing to letting go, at x and y within the waveform.
function click(target: Element, x: number, y: number) {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(target, { clientX: x, clientY: y, pointerId: 1 })
}

describe('Waveform', () => {
  it('seeks when the bars are clicked', () => {
    const { onSeek, onComment, slider } = renderWaveform()
    click(slider, width / 2, barsHeight / 2)
    expect(onSeek).toHaveBeenCalledWith(300)
    expect(onComment).not.toHaveBeenCalled()
  })

  it('offers a comment where the band below the bars is hovered, and asks for one there when clicked', () => {
    const { onSeek, onComment, slider } = renderWaveform()
    fireEvent.pointerMove(slider, { clientX: width / 4, clientY: barsHeight + 10 })
    expect(screen.getByText('Comment at 2:30')).toBeTruthy()
    click(slider, width / 4, barsHeight + 10)
    expect(onComment).toHaveBeenCalledWith(150)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('seeks to a comment when its marker is pressed', () => {
    const { onSeek, onComment } = renderWaveform({
      markers: [{ id: 'c1', seconds: 42, image: null, fallback: 'AB', title: 'Ann: nice' }],
    })
    const marker = screen.getByTitle('0:42 · Ann: nice')
    fireEvent.pointerMove(marker, { clientX: 28, clientY: barsHeight + 10 })
    expect(screen.queryByText(/^Comment at/)).toBeNull()
    click(marker, 28, barsHeight + 10)
    expect(onSeek).toHaveBeenCalledWith(42)
    expect(onComment).not.toHaveBeenCalled()
  })

  it('seeks from the band as well when commenting is off', () => {
    const { onSeek, slider } = renderWaveform({ onComment: undefined })
    fireEvent.pointerMove(slider, { clientX: width / 4, clientY: barsHeight + 10 })
    expect(screen.queryByText(/^Comment at/)).toBeNull()
    click(slider, width / 4, barsHeight + 10)
    expect(onSeek).toHaveBeenCalledWith(150)
  })
})
