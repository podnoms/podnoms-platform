import { describe, expect, it } from 'vitest'
import { htmlToText, plainTextToHtml } from '~/lib/rich-text'

describe('plainTextToHtml', () => {
  it('makes paragraphs from blank-line-separated blocks', () => {
    expect(plainTextToHtml('One\n\nTwo\n\n\nThree')).toBe('<p>One</p><p>Two</p><p>Three</p>')
  })

  it('keeps single line breaks', () => {
    expect(plainTextToHtml('Line 1\nLine 2')).toBe('<p>Line 1<br>Line 2</p>')
  })

  it('normalises Windows and old Mac line endings', () => {
    expect(plainTextToHtml('A\r\n\r\nB\rC')).toBe('<p>A</p><p>B<br>C</p>')
  })

  it('escapes HTML so text cannot inject markup', () => {
    expect(plainTextToHtml('<script>alert("x")</script> & co')).toBe(
      '<p>&lt;script&gt;alert("x")&lt;/script&gt; &amp; co</p>',
    )
  })

  it('returns an empty string for blank text', () => {
    expect(plainTextToHtml('')).toBe('')
    expect(plainTextToHtml('  \n\n  ')).toBe('')
  })
})

describe('htmlToText', () => {
  it('turns paragraphs and breaks into line breaks', () => {
    expect(htmlToText('<p>One</p><p>Two<br>Three</p>')).toBe('One\nTwo\nThree')
  })

  it('strips tags, including attributes', () => {
    expect(htmlToText('<p>A <a href="https://x.test">link</a> and <strong>bold</strong></p>')).toBe(
      'A link and bold',
    )
  })

  it('ends list items, quotes and headings with line breaks', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul><blockquote>q</blockquote><h2>h</h2>')).toBe('a\nb\nq\nh')
  })

  it('decodes named, decimal and hex entities', () => {
    expect(htmlToText('&lt;b&gt; &amp; &quot;q&quot; &apos;s&apos; &#169; &#x1F600; a&nbsp;b')).toBe(
      `<b> & "q" 's' © 😀 a b`,
    )
  })

  it('leaves unknown entities as they are', () => {
    expect(htmlToText('&bogus; &copy;')).toBe('&bogus; &copy;')
  })

  it('collapses blank lines and trims', () => {
    expect(htmlToText('<p>A</p><p></p><p></p><p></p><p>B</p>')).toBe('A\n\nB')
    expect(htmlToText('<p>  </p>')).toBe('')
  })

  it('round-trips plain text, with paragraphs on their own lines', () => {
    const text = 'First paragraph\nwith a break\n\nSecond & <last>'
    expect(htmlToText(plainTextToHtml(text))).toBe('First paragraph\nwith a break\nSecond & <last>')
  })
})
