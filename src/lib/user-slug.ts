import { z } from 'zod'
import { slugify } from '~/lib/slug'

// Users' slugs (handles): in their profile's address (/u/<slug>) and for
// @mentioning them in comments. Lowercase letters and digits, with single
// hyphens between, 2 to 30 long.
export const userSlugMaxLength = 30

export const userSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters')
  .max(userSlugMaxLength, `Use at most ${userSlugMaxLength} characters`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens between them')
  .refine((slug) => !reservedUserSlugs.has(slug), "That one's reserved")

// Ones that would look official, or like a way to mention everyone.
export const reservedUserSlugs = new Set([
  'admin',
  'administrator',
  'everyone',
  'help',
  'here',
  'me',
  'moderator',
  'official',
  'podnoms',
  'root',
  'staff',
  'support',
  'system',
])

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
