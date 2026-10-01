import '@tanstack/react-start/server-only'
import sanitize from 'sanitize-html'
import { htmlToText } from '~/lib/rich-text'

// What the description editor can produce, and what podcast apps render.
const options: sanitize.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote'],
  // rel and target are set on every link by the transform below.
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
}

// Sanitised HTML, or null if the description has no text.
export function sanitizeDescription(html: string | null | undefined) {
  if (!html) return null
  const clean = sanitize(html, options)
  return htmlToText(clean) ? clean : null
}
