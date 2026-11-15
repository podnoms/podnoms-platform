import '@tanstack/react-start/server-only'
import sanitize from 'sanitize-html'
import { htmlToText, plainTextToHtml } from '~/lib/rich-text'

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

// A new show's or episode's description: the editor's HTML, sanitised, or
// plain text (from the browser extension or an older form) made HTML. Null
// when there's none, so an episode falls back on its source's.
export function newDescription(input: { description?: string; descriptionHtml?: string }) {
  if (input.descriptionHtml !== undefined) return sanitizeDescription(input.descriptionHtml)
  return input.description ? plainTextToHtml(input.description) : null
}

// The same, plus headings, for the site's privacy policy and terms (see
// branding.server.ts). Links there open in the same tab.
const pageOptions: sanitize.IOptions = {
  ...options,
  allowedTags: [...(options.allowedTags as string[]), 'h2', 'h3'],
  allowedAttributes: { a: ['href'] },
  transformTags: {},
}

export function sanitizePage(html: string | null | undefined) {
  if (!html) return null
  const clean = sanitize(html, pageOptions)
  return htmlToText(clean) ? clean : null
}
