// Signing in on the mobile app (src/routes/api/mobile/*). The app can't use
// the session cookie, so signing in gives it a token, sent as
// `Authorization: Bearer <token>`; only a hash of it is kept (mobile_token).
// Two-factor authentication still applies: a user with it on gets a
// challenge first, answered with an authenticator or recovery code.
//
// OAuth (GitHub, Google, Facebook) happens in a browser the app opens: the
// usual Auth.js sign-in, whose callback (finishMobileOAuth) sends the browser
// back to the app with a one-time code, which the app exchanges for a token
// or a 2FA challenge. Like OAuth's PKCE, the app proves it started the
// sign-in with a verifier only it knows, so another app that catches the
// redirect can't use the code.
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getSession, readSession } from '~/server/auth.server'
import { db } from '~/server/db/client.server'
import { mobileTokens } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { logger } from '~/server/logger.server'
import { getTwoFactorMethods, hasTwoFactor, redeemTwoFactorTicket, verifySecondFactor } from '~/server/two-factor.server'
import { verifyUser } from '~/server/users.server'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// How often a token's lastUsedAt is brought up to date, so every request
// doesn't write to the database.
const lastUsedResolutionMs = 60 * 60_000

export async function issueMobileToken(userId: string, deviceName?: string) {
  const token = randomBytes(32).toString('base64url')
  await db.insert(mobileTokens).values({ tokenHash: hashToken(token), userId, deviceName: deviceName || null })
  logger.info({ userId }, 'Mobile app signed in')
  return token
}

export async function revokeMobileToken(token: string) {
  await db.delete(mobileTokens).where(eq(mobileTokens.tokenHash, hashToken(token)))
}

function bearerToken(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

// The user whose token the request carries, if any.
export async function mobileUserId(request: Request) {
  const token = bearerToken(request)
  if (!token) return null
  const tokenHash = hashToken(token)
  const [row] = await db
    .select({ userId: mobileTokens.userId, lastUsedAt: mobileTokens.lastUsedAt })
    .from(mobileTokens)
    .where(eq(mobileTokens.tokenHash, tokenHash))
    .limit(1)
  if (!row) return null
  if (Date.now() - row.lastUsedAt.getTime() > lastUsedResolutionMs) {
    await db.update(mobileTokens).set({ lastUsedAt: new Date() }).where(eq(mobileTokens.tokenHash, tokenHash))
  }
  return row.userId
}

// Where to send notifications for the device whose token the request carries.
// A device has one push token, so whoever signed in on it last gets them, if
// someone before them didn't sign out.
export async function setMobilePushToken(request: Request, pushToken: string | null) {
  const token = bearerToken(request)
  if (!token) return
  await db.transaction(async (tx) => {
    if (pushToken) await tx.update(mobileTokens).set({ pushToken: null }).where(eq(mobileTokens.pushToken, pushToken))
    await tx.update(mobileTokens).set({ pushToken }).where(eq(mobileTokens.tokenHash, hashToken(token)))
  })
}

// The token the request carries, to sign out with.
export function requestMobileToken(request: Request) {
  return bearerToken(request)
}

// The user making a request, by token (the app) or session cookie (the site),
// for endpoints both use, such as an episode's audio.
export async function requestUserId(request: Request) {
  if (bearerToken(request)) return mobileUserId(request)
  return (await getSession(request))?.user?.id ?? null
}

// The signed-in user's id, or the response to send instead.
export async function mobileApiUserId(request: Request): Promise<string | Response> {
  return (await mobileUserId(request)) ?? new Response('You need to be signed in', { status: 401 })
}

// --- Signing in ---------------------------------------------------------------

type PendingSignIn = { userId: string; deviceName?: string }

// Users who gave the right password and still owe a second factor, by challenge.
const challenges = new ExpiringStore<PendingSignIn>(5 * 60_000)

export type MobileSignInResult =
  | { status: 'signed-in'; token: string }
  | { status: 'two-factor'; challenge: string; methods: { totp: boolean; recovery: true } }
  | { status: 'refused' }

export async function startMobileSignIn(email: string, password: string, deviceName?: string): Promise<MobileSignInResult> {
  const user = await verifyUser(email, password)
  if (!user) {
    logger.info({ type: 'mobile' }, 'Sign-in refused')
    return { status: 'refused' }
  }
  return signInUser(user.id, deviceName)
}

// A token, or a challenge if the user has a second factor to pass.
async function signInUser(userId: string, deviceName?: string): Promise<MobileSignInResult> {
  const methods = await getTwoFactorMethods(userId)
  if (!methods.totp && !methods.securityKey) {
    return { status: 'signed-in', token: await issueMobileToken(userId, deviceName) }
  }
  const challenge = randomBytes(32).toString('base64url')
  challenges.set(challenge, { userId, deviceName })
  return { status: 'two-factor', challenge, methods: { totp: methods.totp, recovery: true } }
}

// Checks the second factor for a challenge. A wrong code leaves the challenge
// open (verifySecondFactor counts failures and locks the user out); a right
// one uses it up.
export async function finishMobileSignIn(
  challenge: string,
  factor: { method: 'totp' | 'recovery'; code: string },
  url: URL,
): Promise<{ ok: true; token: string } | { ok: false; error: string; expired?: true }> {
  const pending = challenges.get(challenge)
  if (!pending) return { ok: false, error: 'That sign-in has expired. Please sign in again.', expired: true }
  const result = await verifySecondFactor(pending.userId, factor, url)
  if (!result.ok) return result
  challenges.delete(challenge)
  redeemTwoFactorTicket(result.ticket, pending.userId)
  return { ok: true, token: await issueMobileToken(pending.userId, pending.deviceName) }
}

// --- OAuth --------------------------------------------------------------------

// Where the browser may send a code: the app's own URL scheme, or the app's
// web build (for development) on this machine, at its sign-in page. Nowhere
// else, as whoever gets the code there could have made the challenge too.
export const mobileRedirectSchemes = ['podnoms:']
const localHosts = ['localhost', '127.0.0.1', '[::1]']

export function isMobileRedirect(uri: string) {
  try {
    const url = new URL(uri)
    if (mobileRedirectSchemes.includes(url.protocol)) return true
    return url.protocol === 'http:' && localHosts.includes(url.hostname) && url.pathname === '/sign-in'
  } catch {
    return false
  }
}

// What the app sends to start an OAuth sign-in, carried through Auth.js in
// the callback URL.
export type MobileOAuthRequest = { redirectUri: string; codeChallenge: string }

// Codes handed back to the app, waiting to be exchanged.
const oauthCodes = new ExpiringStore<{ userId: string; codeChallenge: string }>(2 * 60_000)

const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

// Where Auth.js sends the browser once the provider has signed the user in:
// back to the app, with a code for whoever is signed in (or still owes a
// second factor) in this browser.
export async function finishMobileOAuth(request: Request, { redirectUri, codeChallenge }: MobileOAuthRequest) {
  const back = new URL(redirectUri)
  const session = await readSession(request)
  const userId = session?.user?.id
  if (!userId) {
    back.searchParams.set('error', "Signing in didn't work. Please try again.")
    return back.href
  }
  const code = randomBytes(32).toString('base64url')
  oauthCodes.set(code, { userId, codeChallenge })
  back.searchParams.set('code', code)
  return back.href
}

// The app trades its code, with the verifier it made the challenge from, for
// a token or a 2FA challenge, as with a password.
export async function exchangeMobileOAuthCode(code: string, codeVerifier: string, deviceName?: string) {
  const pending = oauthCodes.take(code)
  if (!pending || pending.codeChallenge !== challengeFor(codeVerifier)) return null
  logger.info({ userId: pending.userId, twoFactor: await hasTwoFactor(pending.userId) }, 'Mobile OAuth sign-in')
  return signInUser(pending.userId, deviceName)
}
