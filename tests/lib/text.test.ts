import { describe, expect, it } from 'vitest'
import { insertText } from '~/lib/text'

describe('insertText', () => {
  it('puts the text at the cursor, with the cursor after it', () => {
    expect(insertText('hello world', '👋', 5, 5, 100)).toEqual({ text: 'hello👋 world', cursor: 7 })
    expect(insertText('', '🎉', 0, 0, 100)).toEqual({ text: '🎉', cursor: 2 })
  })

  it('replaces a selection', () => {
    expect(insertText('I love it', '❤️', 2, 6, 100)).toEqual({ text: 'I ❤️ it', cursor: 4 })
  })

  it('keeps positions within the text', () => {
    expect(insertText('abc', '!', 10, 20, 100)).toEqual({ text: 'abc!', cursor: 4 })
    expect(insertText('abc', '!', 2, 1, 100)).toEqual({ text: 'ab!c', cursor: 3 })
  })

  it("won't go over the length limit", () => {
    expect(insertText('abcd', '😀', 4, 4, 5)).toBeNull()
    expect(insertText('abcd', '😀', 4, 4, 6)).toEqual({ text: 'abcd😀', cursor: 6 })
  })
})
