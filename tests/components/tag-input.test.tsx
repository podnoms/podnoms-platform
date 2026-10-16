// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagInput } from '~/components/tag-input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { fetchTagSuggestions } from '~/functions/tags'
import { maxTags, type Tag } from '~/lib/tag-schema'

vi.mock('~/functions/tags', () => ({ fetchTagSuggestions: vi.fn() }))

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  vi.mocked(fetchTagSuggestions).mockReset().mockResolvedValue([])
})
afterEach(cleanup)

function renderInput(initial: string[] = [], disabled = false) {
  const onSubmit = vi.fn()
  function Form() {
    const [tags, setTags] = useState(initial)
    return (
      <form onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        <TagInput value={tags} onChange={setTags} disabled={disabled} />
        <output aria-label="Selected tags">{JSON.stringify(tags)}</output>
        <button type="submit">Save</button>
      </form>
    )
  }
  render(<Form />)
  return { input: screen.getByRole('combobox', { name: 'Tags' }), onSubmit }
}

function selectedTags() {
  return JSON.parse(screen.getByLabelText('Selected tags').textContent!) as string[]
}

describe('TagInput', () => {
  it('normalizes new tags and never submits the form when Enter adds one', async () => {
    const { input, onSubmit } = renderInput()
    await userEvent.type(input, '  Deep   House  {Enter}')
    expect(selectedTags()).toEqual(['deep house'])
    expect((input as HTMLInputElement).value).toBe('')
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.keyboard('{Enter}')
    expect(selectedTags()).toEqual(['deep house'])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('searches existing tags and selects the highlighted result with the keyboard', async () => {
    vi.mocked(fetchTagSuggestions).mockResolvedValue([{ id: 'tag-1', name: 'deep house', slug: 'deep-house' }])
    const { input, onSubmit } = renderInput()
    await userEvent.type(input, 'deep')
    await screen.findByRole('option', { name: 'deep house' })
    expect(fetchTagSuggestions).toHaveBeenCalledWith({ data: { query: 'deep' } })

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(selectedTags()).toEqual(['deep house'])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('lets an existing tag be selected with the pointer', async () => {
    vi.mocked(fetchTagSuggestions).mockResolvedValue([{ id: 'tag-1', name: 'techno', slug: 'techno' }])
    const { input, onSubmit } = renderInput()
    await userEvent.type(input, 'tech')
    await userEvent.click(await screen.findByRole('option', { name: 'techno' }))
    expect(selectedTags()).toEqual(['techno'])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps suggestions usable inside the edit dialog', async () => {
    vi.mocked(fetchTagSuggestions).mockResolvedValue([{ id: 'tag-1', name: 'techno', slug: 'techno' }])
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    function EditDialog() {
      const [tags, setTags] = useState<string[]>([])
      return (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>Add tags to the episode.</DialogDescription>
            <TagInput value={tags} onChange={(next) => { setTags(next); onChange(next) }} />
          </DialogContent>
        </Dialog>
      )
    }
    render(<EditDialog />)
    const input = screen.getByRole('combobox', { name: 'Tags' })
    await userEvent.type(input, 'tech')
    await userEvent.click(await screen.findByRole('option', { name: 'techno' }))
    expect(onChange).toHaveBeenCalledWith(['techno'])
    expect(document.activeElement).toBe(input)
    await userEvent.click(screen.getByRole('button', { name: 'Remove techno' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(document.activeElement).toBe(input)

    await userEvent.type(input, 'tech')
    await screen.findByRole('option', { name: 'techno' })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['techno'])
    expect(document.activeElement).toBe(input)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('deduplicates existing selections and removes them with buttons or Backspace', async () => {
    const { input, onSubmit } = renderInput(['house', 'techno'])
    await userEvent.type(input, 'HOUSE{Enter}')
    expect(selectedTags()).toEqual(['house', 'techno'])

    await userEvent.click(screen.getByRole('button', { name: 'Remove house' }))
    expect(selectedTags()).toEqual(['techno'])
    await userEvent.click(input)
    await userEvent.keyboard('{Backspace}')
    expect(selectedTags()).toEqual([])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps new tag entry available when suggestions fail', async () => {
    vi.mocked(fetchTagSuggestions).mockRejectedValue(new Error('offline'))
    const { input } = renderInput()
    await userEvent.type(input, 'ambient')
    expect(await screen.findByText('Suggestions are unavailable. You can still add a tag.')).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    expect(selectedTags()).toEqual(['ambient'])
  })

  it('ignores a slow response from an earlier query', async () => {
    let resolveFirst!: (tags: Tag[]) => void
    vi.mocked(fetchTagSuggestions)
      .mockImplementationOnce(() => new Promise<Tag[]>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce([{ id: 'tag-2', name: 'techno', slug: 'techno' }])
    const { input } = renderInput()
    await userEvent.type(input, 'house')
    await waitFor(() => expect(fetchTagSuggestions).toHaveBeenCalledWith({ data: { query: 'house' } }))
    await userEvent.clear(input)
    await userEvent.type(input, 'tech')
    await screen.findByRole('option', { name: 'techno' })

    await act(async () => { resolveFirst([{ id: 'tag-1', name: 'house music', slug: 'house-music' }]) })
    expect(screen.queryByRole('option', { name: 'house music' })).toBeNull()
    expect(screen.getByRole('option', { name: 'techno' })).toBeTruthy()
  })

  it('enforces the tag limit while leaving existing tags removable', async () => {
    const initial = Array.from({ length: maxTags }, (_, i) => `tag ${i}`)
    const { input } = renderInput(initial)
    await userEvent.type(input, 'another{Enter}')
    expect(selectedTags()).toEqual(initial)
    expect(await screen.findByText(`Add up to ${maxTags} tags`)).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove tag 0' }))
    await userEvent.type(input, 'another{Enter}')
    expect(selectedTags()).toEqual([...initial.slice(1), 'another'])
  })

  it('does not select a highlighted tag when Enter completes IME composition', async () => {
    vi.mocked(fetchTagSuggestions).mockResolvedValue([{ id: 'tag-1', name: '音楽', slug: 'tag' }])
    const { input, onSubmit } = renderInput()
    await userEvent.type(input, '音楽')
    await screen.findByRole('option', { name: '音楽' })
    await userEvent.keyboard('{ArrowDown}')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(selectedTags()).toEqual([])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables input and removal while saving', async () => {
    const { input } = renderInput(['house'], true)
    expect((input as HTMLInputElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Remove house' }))
    expect(selectedTags()).toEqual(['house'])
    expect(fetchTagSuggestions).not.toHaveBeenCalled()
  })
})
