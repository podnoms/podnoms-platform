// Descriptions are stored as HTML, written in the rich text editor and
// sanitised on the server (see rich-text.server.ts).

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Plain text, e.g. a YouTube description, as HTML: blank lines separate
// paragraphs and single line breaks are kept.
export function plainTextToHtml(text: string) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
}

// The text of a description, for one-line previews and plain-text fields.
// Only ever render the result as text, never as HTML.
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|blockquote|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : match
      }
      return entities[entity.toLowerCase()] ?? match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
