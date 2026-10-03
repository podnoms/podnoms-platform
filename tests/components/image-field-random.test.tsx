// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageField, type ImageValue } from '~/components/image-field'
import { suggestArtwork } from '~/functions/images'

vi.mock('~/functions/images', () => ({ suggestArtwork: vi.fn() }))
afterEach(cleanup)

const suggestion = (id: number) => ({
  ok: true as const,
  suggestion: {
    imageId: `image-${id}`,
    previewUrl: `https://images.pexels.test/${id}.jpeg`,
    photoId: String(id),
    credit: {
      author: `Photographer ${id}`,
      authorUrl: `https://www.pexels.com/@p${id}`,
      pageUrl: `https://www.pexels.com/photo/${id}/`,
      source: 'Pexels' as const,
      sourceUrl: 'https://www.pexels.com',
    },
  },
})

function Field({ suggest, onValue }: { suggest?: () => { title: string }; onValue?: (value: ImageValue) => void }) {
  const [value, setValue] = useState<ImageValue>({ kind: 'keep' })
  return (
    <ImageField
      imageUrl={null}
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue?.(next)
      }}
      suggest={suggest}
    />
  )
}

describe('ImageField random image', () => {
  it('credits Openverse photos, with or without a named photographer', async () => {
    vi.mocked(suggestArtwork).mockResolvedValueOnce({
      ok: true,
      suggestion: {
        imageId: 'image-x',
        previewUrl: 'https://api.openverse.org/v1/images/x/thumb/',
        photoId: 'x',
        credit: { author: null, authorUrl: null, pageUrl: 'https://photos.test/x', source: 'Openverse', sourceUrl: 'https://openverse.org' },
      },
    })
    render(<Field suggest={() => ({ title: 'x' })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Random image' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Openverse' })).toBeTruthy())
    expect(screen.getByText(/via/).textContent).toBe('Photo via Openverse')
  })

  it('is only offered when the form can suggest images', () => {
    render(<Field />)
    expect(screen.queryByRole('button', { name: 'Random image' })).toBeNull()
  })

  it('shows a suggested image with its credit, and asks for a different one next time', async () => {
    vi.mocked(suggestArtwork).mockResolvedValueOnce(suggestion(1)).mockResolvedValueOnce(suggestion(2))
    const values: ImageValue[] = []
    render(<Field suggest={() => ({ title: 'Deep Jazz' })} onValue={(value) => values.push(value)} />)

    await userEvent.click(screen.getByRole('button', { name: 'Random image' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Photographer 1' }).getAttribute('href')).toBe('https://www.pexels.com/@p1'))
    expect(screen.getByRole('link', { name: 'Photo' }).getAttribute('href')).toBe('https://www.pexels.com/photo/1/')
    expect(screen.getByRole('link', { name: 'Pexels' }).getAttribute('href')).toBe('https://www.pexels.com')
    expect(suggestArtwork).toHaveBeenLastCalledWith({ data: { title: 'Deep Jazz', exclude: [] } })
    expect(values.at(-1)).toMatchObject({ kind: 'uploaded', imageId: 'image-1' })
    expect(document.querySelector('img')!.getAttribute('src')).toBe('https://images.pexels.test/1.jpeg')

    await userEvent.click(screen.getByRole('button', { name: 'Random image' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Photographer 2' })).toBeTruthy())
    expect(suggestArtwork).toHaveBeenLastCalledWith({ data: { title: 'Deep Jazz', exclude: ['1'] } })
  })

  it('says why when there is nothing to suggest', async () => {
    vi.mocked(suggestArtwork).mockResolvedValueOnce({ ok: false, error: "Couldn't find any more images." })
    render(<Field suggest={() => ({ title: 'x' })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Random image' }))
    expect(await screen.findByText("Couldn't find any more images.")).toBeTruthy()
  })
})
