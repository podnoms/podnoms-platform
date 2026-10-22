// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CommentComposer } from '~/components/comment-composer'
import type { ChatGif } from '~/lib/gifs'

const wave = vi.hoisted(() => ({
  provider: 'giphy' as const,
  id: 'g1',
  title: 'Wave',
  url: 'https://media.giphy.com/media/g1/giphy.gif',
  width: 200,
  height: 150,
}))

vi.mock('~/functions/comments', () => ({ searchMentions: vi.fn().mockResolvedValue([]) }))
vi.mock('~/lib/gifs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/gifs')>()),
  searchGifs: vi.fn().mockResolvedValue({
    results: [{ ...wave, preview: { url: 'https://media.giphy.com/media/g1/200w.gif', width: 200, height: 150 } }],
    next: null,
  }),
}))

beforeAll(() => {
  // Used by Radix, missing from happy-dom.
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

function Harness({ withGifs = true }: { withGifs?: boolean }) {
  const [value, setValue] = useState('')
  const [gif, setGif] = useState<ChatGif | null>(null)
  return (
    <CommentComposer
      aria-label="Comment"
      value={value}
      onValueChange={setValue}
      gif={gif}
      onGifChange={setGif}
      gifs={withGifs ? { provider: 'giphy', key: 'public-key' } : null}
    />
  )
}

describe('CommentComposer', () => {
  it('attaches a GIF from the panel, shown until it is removed', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji or GIF' }))
    // Radix tabs switch on mouse down.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'GIF' }))
    fireEvent.click(await screen.findByTitle('Wave'))
    const attached = await screen.findByAltText('Wave')
    expect(attached.getAttribute('src')).toBe(wave.url)
    fireEvent.click(screen.getByRole('button', { name: 'Remove the GIF' }))
    expect(screen.queryByAltText('Wave')).toBeNull()
  })

  it('offers just emoji when the site has no GIF provider', () => {
    render(<Harness withGifs={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add an emoji' }))
    expect(screen.queryByRole('tab', { name: 'GIF' })).toBeNull()
  })
})
