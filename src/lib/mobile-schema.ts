import { z } from 'zod'
import { credentialsSchema } from '~/lib/auth-schema'
import { commentMaxLength } from '~/lib/comment-schema'
import { chatGifSchema } from '~/lib/gifs'
import { chatMessageMaxLength } from '~/lib/live-schema'

// What the mobile app sends to /api/mobile/*.

// Signing in with an email and password; the device's name is shown nowhere
// yet, but kept with its token so devices can be listed later.
export const mobileSignInSchema = credentialsSchema.extend({
  deviceName: z.string().trim().max(100).optional(),
})

// The second step of signing in, for users with two-factor authentication.
// Security keys aren't offered on the app: those users can use a recovery code.
export const mobileTwoFactorSchema = z.object({
  challenge: z.string().min(1).max(200),
  method: z.enum(['totp', 'recovery']),
  code: z.string().trim().min(1).max(100),
})

export const mobilePositionSchema = z.object({ seconds: z.number().min(0).max(60 * 60 * 24 * 7) })

export const mobileEpisodePageSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

// Starting an OAuth sign-in in the browser the app opens. The challenge is
// the base64url SHA-256 of a verifier the app keeps (as OAuth's PKCE, S256).
export const mobileOAuthStartSchema = z.object({
  redirect_uri: z.string().min(1).max(500),
  code_challenge: z.string().regex(/^[\w-]{43}$/, 'Invalid code challenge'),
})

export const mobileOAuthExchangeSchema = z.object({
  code: z.string().min(1).max(200),
  codeVerifier: z.string().min(43).max(128),
  deviceName: z.string().trim().max(100).optional(),
})

// A comment, or a reply to `parentId`, from the app, at `atSeconds` in the
// episode: text, a GIF (from the provider's own servers, as on the site), or both.
export const mobileCommentSchema = z
  .object({
    body: z.string().trim().max(commentMaxLength).default(''),
    gif: chatGifSchema.optional(),
    atSeconds: z.number().min(0),
    parentId: z.string().min(1).optional(),
  })
  .refine((comment) => comment.body || comment.gif, { message: 'Write something first', path: ['body'] })

export const mobileCommentLikeSchema = z.object({ like: z.boolean() })

// A message in a broadcast's chat: text, a GIF, or both, as on the site.
export const mobileChatSchema = z
  .object({
    body: z.string().trim().max(chatMessageMaxLength).default(''),
    gif: chatGifSchema.optional(),
  })
  .refine((message) => message.body || message.gif, { message: 'Write something first', path: ['body'] })

// Which notifications the user gets on the app about the shows they follow.
export const mobileNotificationPrefsSchema = z.object({ live: z.boolean(), newEpisodes: z.boolean() })

export const mobileShowNotifySchema = z.object({ showId: z.string().min(1), notify: z.boolean() })

// An Expo push token, as the device got it from Expo.
export const mobilePushDeviceSchema = z.object({
  pushToken: z
    .string()
    .regex(/^Expo(nent)?PushToken\[[\w-]+\]$/)
    .nullable(),
})
