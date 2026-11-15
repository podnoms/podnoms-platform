// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownLinks, editorMarkdown, linkHref, looksLikeMarkdown } from '~/lib/markdown-editing'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

// The description editor's set-up (see rich-text-editor.tsx).
function makeEditor() {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false, code: false, codeBlock: false, horizontalRule: false }),
      Markdown,
      MarkdownLinks,
    ],
  })
  return editor
}

describe('looksLikeMarkdown', () => {
  it('spots links, bold, headings, lists and quotes', () => {
    expect(looksLikeMarkdown('See [the site](https://example.com)')).toBe(true)
    expect(looksLikeMarkdown('This is **important**')).toBe(true)
    expect(looksLikeMarkdown('# Tracklist\n\nOne')).toBe(true)
    expect(looksLikeMarkdown('Tracks:\n- One\n- Two')).toBe(true)
    expect(looksLikeMarkdown('1. One\n2. Two')).toBe(true)
    expect(looksLikeMarkdown('> A quote')).toBe(true)
  })

  it('leaves plain text alone', () => {
    expect(looksLikeMarkdown('If ever there was a definitive tune, this is it.\nPiano House?')).toBe(false)
    expect(looksLikeMarkdown('5 * 3 = 15 - give or take')).toBe(false)
    expect(looksLikeMarkdown('- just one dash line\nand some text')).toBe(false)
    expect(looksLikeMarkdown('#hashtag')).toBe(false)
  })
})

describe('editorMarkdown', () => {
  it('makes headings bold lines without headings, and the levels pages have with them', () => {
    expect(editorMarkdown('# One\nText\n## Two ##', { headings: false })).toBe('**One**\nText\n**Two**')
    expect(editorMarkdown('# One\n#### Four', { headings: true })).toBe('## One\n### Four')
  })
})

describe('linkHref', () => {
  it('keeps web and mail links, and makes anything else a web address', () => {
    expect(linkHref('https://a.com')).toBe('https://a.com')
    expect(linkHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(linkHref('a.com/x')).toBe('https://a.com/x')
    expect(linkHref('javascript:alert(1)')).toBe('https://javascript:alert(1)')
  })
})

describe('markdown in the editor', () => {
  it('turns pasted markdown into the formatting descriptions allow', () => {
    const editor = makeEditor()
    editor.commands.insertContent('Intro with **bold** and [a link](https://a.com)\n\n- One\n- Two\n\n> Quote', {
      contentType: 'markdown',
    })
    const html = editor.getHTML()
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toMatch(/<a [^>]*href="https:\/\/a.com"[^>]*>a link<\/a>/)
    expect(html).toContain('<ul>')
    expect(html).toContain('<blockquote>')
  })

  it("keeps a heading's text when headings are off", () => {
    const editor = makeEditor()
    editor.commands.insertContent(editorMarkdown('# Tracklist\n\nOne', { headings: false }), { contentType: 'markdown' })
    expect(editor.getHTML()).toBe('<p><strong>Tracklist</strong></p><p>One</p>')
  })

  it('makes a link from [text](url) as it is typed', () => {
    const editor = makeEditor()
    const text = 'see [here](a.com)'
    // Input rules run on text typed in, one character at a time.
    for (const char of text) {
      const { from, to } = editor.state.selection
      const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, char, () => editor.state.tr))
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
    }
    expect(editor.getHTML()).toMatch(/see <a [^>]*href="https:\/\/a.com"[^>]*>here<\/a>/)
  })
})
