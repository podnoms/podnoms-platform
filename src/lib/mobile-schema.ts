import { z } from 'zod'
import { credentialsSchema } from '~/lib/auth-schema'
import { commentMaxLength } from '~/lib/comment-schema'

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

// A comment, or a reply to `parentId`, from the app: text only (GIFs are
// picked on the site), at `atSeconds` in the episode.
export const mobileCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(commentMaxLength),
  atSeconds: z.number().min(0),
  parentId: z.string().min(1).optional(),
})

export const mobileCommentLikeSchema = z.object({ like: z.boolean() })
