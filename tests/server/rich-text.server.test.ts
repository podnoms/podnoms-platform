import { describe, expect, it } from 'vitest'
import { newDescription, sanitizeDescription } from '~/server/rich-text.server'

// An attribute of the first tag in some HTML, whatever order they're in.
const attr = (html: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(html)?.[1]

describe('sanitizeDescription', () => {
  it('returns null for missing or textless descriptions', () => {
    expect(sanitizeDescription(null)).toBeNull()
    expect(sanitizeDescription(undefined)).toBeNull()
    expect(sanitizeDescription('')).toBeNull()
    expect(sanitizeDescription('<p></p><p><br></p>')).toBeNull()
    expect(sanitizeDescription('<script>alert(1)</script>')).toBeNull()
  })

  it('keeps the formatting the editor produces', () => {
    const html = '<p><strong>Bold</strong> <em>em</em> <u>u</u> <s>s</s></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>'
    expect(sanitizeDescription(html)).toBe(html)
  })

  it('removes scripts, event handlers, styles and unknown tags', () => {
    expect(sanitizeDescription('<p onclick="x()" style="color:red">Hi<script>alert(1)</script><img src=x onerror=y></p>')).toBe(
      '<p>Hi</p>',
    )
    expect(sanitizeDescription('<h1>Title</h1><div>text</div>')).toBe('Titletext')
  })

  it('opens links in a new tab without an opener', () => {
    const html = sanitizeDescription('<a href="https://example.com" target="_self" rel="opener">x</a>')!
    expect(attr(html, 'href')).toBe('https://example.com')
    expect(attr(html, 'target')).toBe('_blank')
    expect(attr(html, 'rel')).toBe('noopener noreferrer')
  })

  it('drops unsafe link schemes', () => {
    expect(sanitizeDescription('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript')
    expect(sanitizeDescription('<a href="data:text/html,hi">x</a>')).not.toContain('data:')
    expect(sanitizeDescription('<a href="mailto:a@b.co">mail</a>')).toContain('href="mailto:a@b.co"')
  })
})

describe('newDescription', () => {
  it('sanitises HTML from the editor, or makes plain text HTML', () => {
    expect(newDescription({ descriptionHtml: '<p>Hi <a href="https://a.com" onclick="x">a</a></p>' })).toBe(
      '<p>Hi <a href="https://a.com" rel="noopener noreferrer" target="_blank">a</a></p>',
    )
    expect(newDescription({ description: 'One\n\nTwo' })).toBe('<p>One</p><p>Two</p>')
    expect(newDescription({ description: 'plain', descriptionHtml: '<p></p>' })).toBeNull()
    expect(newDescription({})).toBeNull()
  })
})
