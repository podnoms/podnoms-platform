import { z } from 'zod'
import { reservedUserSlugs } from '~/lib/paths'
import { slugify } from '~/lib/slug'

// Users' slugs (handles): their profile's address (/<slug>), which their
// shows' addresses start with, and for @mentioning them in comments.
// Lowercase letters and digits, with single hyphens between, 2 to 30 long.
// Not any of reservedUserSlugs (src/lib/paths.ts), which the site's own
// top-level pages take.
export const userSlugMaxLength = 30

export const userSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters')
  .max(userSlugMaxLength, `Use at most ${userSlugMaxLength} characters`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens between them')
  .refine((slug) => !reservedUserSlugs.has(slug), "That one's reserved")

export { reservedUserSlugs }

// The slug to try for a new user, from their name or email's local part,
// leaving room for a -2, -3... if it's taken.
export function userSlugBase(source: string) {
  const base = slugify(source, 'user').slice(0, userSlugMaxLength - 4).replace(/-+$/, '')
  return base.length < 2 ? 'user' : base
}

// @ then a slug, not straight after a letter, digit or @ (so email addresses
// aren't mentions). Group 2 is the slug.
export const mentionPattern = /(^|[^a-z0-9@])@([a-z0-9]+(?:-[a-z0-9]+)*)/gi

// The slugs a comment mentions, lowercased, each once.
export function mentionedSlugs(text: string) {
  return [...new Set([...text.matchAll(mentionPattern)].map((match) => match[2]!.toLowerCase()))]
}

// How a mention is stored in a comment's body: by the user's id, so it
// follows them if their slug changes.
export const storedMentionPattern = /<@([0-9a-f-]{36})>/g
export const storedMention = (userId: string) => `<@${userId}>`

// Who a comment mentions, by user id: their slug and name now.
export type CommentMentions = Record<string, { slug: string; name: string | null }>

// A comment's body with its mentions as @slug, for emails and notifications.
export function mentionsAsText(body: string, mentions: CommentMentions) {
  return body.replace(storedMentionPattern, (token, userId: string) => (mentions[userId] ? `@${mentions[userId].slug}` : token))
}
