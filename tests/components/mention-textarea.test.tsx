// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MentionTextarea } from '~/components/mention-textarea'
import { searchMentions } from '~/functions/comments'

vi.mock('~/functions/comments', () => ({ searchMentions: vi.fn() }))

beforeEach(() =>
  vi.mocked(searchMentions).mockReset().mockResolvedValue([
    { slug: 'ann', name: 'Ann', image: null },
    { slug: 'annette', name: null, image: null },
  ]),
)
afterEach(cleanup)

function Harness() {
  const [value, setValue] = useState('')
  return <MentionTextarea aria-label="Comment" value={value} onValueChange={setValue} />
}

// Types `text` as if the caret were at its end.
function type(textarea: HTMLTextAreaElement, text: string) {
  fireEvent.change(textarea, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } })
}

describe('MentionTextarea', () => {
  it('opens on @, suggests users matching what follows, and puts the chosen one in', async () => {
    render(<Harness />)
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Comment')
    type(textarea, 'Thanks @')
    expect(screen.getByText('Type a name or username')).toBeTruthy()

    type(textarea, 'Thanks @an')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(searchMentions).toHaveBeenCalledWith({ data: { query: 'an' } })

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(textarea.value).toBe('Thanks @annette ')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it("doesn't take an email address for a mention, and closes on Escape", async () => {
    render(<Harness />)
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Comment')
    type(textarea, 'me@ann')
    expect(screen.queryByRole('listbox')).toBeNull()
    type(textarea, 'hi @a')
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
