// Markdown in the rich text editor (rich-text-editor.tsx). StarterKit already
// turns **bold**, *italic*, ~~strike~~, "- ", "1. " and "> " into formatting
// as they're typed; this adds links, and tells pasted markdown from plain text.
import { Extension, InputRule } from '@tiptap/core'

// [text](url), as it's finished with the closing bracket.
const markdownLink = /\[([^\]\n]+)\]\((\S+?)\)$/

// A link's address as the editor would make it: http(s) and mailto as they
// are, anything else taken as a web address. (The server sanitises it again.)
export function linkHref(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`
}

export const MarkdownLinks = Extension.create({
  name: 'markdownLinks',
  addInputRules() {
    return [
      new InputRule({
        find: markdownLink,
        handler: ({ state, range, match }) => {
          const link = state.schema.marks.link
          const [, text, url] = match
          if (!link || !text || !url) return null
          state.tr
            .replaceWith(range.from, range.to, state.schema.text(text, [link.create({ href: linkHref(url) })]))
            .removeStoredMark(link)
        },
      }),
    ]
  },
})

// Whether pasted plain text is written in markdown, rather than just text
// (where a stray * or - should stay as it is): it has a link, bold or
// strikethrough, a heading, or lines that make a list or quote.
export function looksLikeMarkdown(text: string) {
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(text)) return true
  if (/(\*\*|__)[^\s*_](.*?[^\s*_])?\1/.test(text)) return true
  if (/~~[^~\n]+~~/.test(text)) return true
  if (/^#{1,6} \S/m.test(text)) return true
  const lines = text.split(/\r?\n/)
  const listOrQuote = lines.filter((line) => /^\s*([-*+] |\d+[.)] |> )\S/.test(line))
  return listOrQuote.length >= 2 || (listOrQuote.length === 1 && lines.length === 1 && /^> /.test(text))
}

// Pasted markdown as the editor can take it: without headings (descriptions
// have none), a heading's line becomes a bold one rather than being lost.
export function editorMarkdown(text: string, { headings }: { headings: boolean }) {
  if (headings) return text.replace(/^(#{4,6}) /gm, '### ').replace(/^# /gm, '## ')
  return text.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '**$1**')
}
