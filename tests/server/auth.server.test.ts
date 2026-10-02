import { Secret, TOTP } from 'otpauth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authConfig,
  getSession,
  getTwoFactorPendingUserId,
  handleAuthRequest,
  oauthProviders,
  publicUrl,
  readSession,
} from '~/server/auth.server'
import { confirmTotpSetup, startTotpSetup, verifySecondFactor } from '~/server/two-factor.server'
import { createUser } from '~/server/users.server'
import { resetDb } from '../db'
import { createUser as insertUser, db } from '../helpers'

const origin = 'http://localhost:5173'

beforeEach(() => resetDb(db))

// Cookies a browser would hold, as a Cookie header.
function cookiesFrom(...responses: Response[]) {
  return responses
    .flatMap((response) => response.headers.getSetCookie())
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

// Signs in the way the login form does (see auth-client.ts).
async function signIn(email: string, password: string) {
  const csrf = await handleAuthRequest(new Request(`${origin}/api/auth/csrf`))
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  const response = await handleAuthRequest(
    new Request(`${origin}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesFrom(csrf) },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: '/' }),
    }),
  )
  return { response, cookie: cookiesFrom(csrf, response) }
}

const pageRequest = (cookie: string) => new Request(`${origin}/podcasts`, { headers: { cookie } })
const sessionFor = (cookie: string) => getSession(pageRequest(cookie))

// Updates the session the way updateSession in auth-client.ts does, returning
// the cookies the browser would then hold.
async function updateSession(cookie: string, data: Record<string, unknown>) {
  const csrf = await handleAuthRequest(new Request(`${origin}/api/auth/csrf`, { headers: { cookie } }))
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  const withCsrf = [cookie, cookiesFrom(csrf)].filter(Boolean).join('; ')
  const response = await handleAuthRequest(
    new Request(`${origin}/api/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: withCsrf },
      body: JSON.stringify({ csrfToken, data }),
    }),
  )
  // Later cookies win, as in a browser.
  const jar = new Map([withCsrf, cookiesFrom(response)].join('; ').split('; ').filter(Boolean).map((c) => {
    const at = c.indexOf('=')
    return [c.slice(0, at), c.slice(at + 1)] as const
  }))
  return [...jar].filter(([, value]) => value).map(([name, value]) => `${name}=${value}`).join('; ')
}

describe('signing in with email and password', () => {
  it('gives a session carrying the database user ID', async () => {
    const user = await createUser('me@example.com', 'password123')
    const { response, cookie } = await signIn('ME@example.com', 'password123')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${origin}/`)
    expect(cookie).toContain('authjs.session-token=')
    const session = await sessionFor(cookie)
    expect(session?.user).toMatchObject({ id: user!.id, email: 'me@example.com' })
  })

  it('refuses a wrong password, sending the user back to the login page', async () => {
    await createUser('me@example.com', 'password123')
    const { response, cookie } = await signIn('me@example.com', 'wrong-password')
    expect(response.headers.get('location')).toMatch(/\/login\?error=CredentialsSignin/)
    expect(cookie).not.toContain('session-token')
    expect(await sessionFor(cookie)).toBeNull()
  })

  it('refuses input the credentials schema rejects', async () => {
    await createUser('me@example.com', 'password123')
    const { cookie } = await signIn('not-an-email', 'password123')
    expect(await sessionFor(cookie)).toBeNull()
  })

  it('refuses requests without the CSRF token', async () => {
    await createUser('me@example.com', 'password123')
    const response = await handleAuthRequest(
      new Request(`${origin}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'me@example.com', password: 'password123' }),
      }),
    )
    expect(cookiesFrom(response)).not.toContain('session-token')
  })
})

describe('signing in with two-factor authentication on', () => {
  async function userWithTotp() {
    const user = (await createUser('me@example.com', 'password123'))!
    const { secret } = await startTotpSetup(user.id)
    const totp = new TOTP({ secret: Secret.fromBase32(secret) })
    await confirmTotpSetup(user.id, totp.generate())
    return { user, totp }
  }

  async function ticketFor(userId: string, totp: TOTP) {
    // A fresh code: the one used for setup can't be used again.
    const result = await verifySecondFactor(userId, { method: 'totp', code: totp.generate({ timestamp: Date.now() + 30_000 }) }, new URL(origin))
    if (!result.ok) throw new Error(result.error)
    return result.ticket
  }

  it('gives a session pending the second factor, which getSession treats as signed out', async () => {
    const { user } = await userWithTotp()
    const { cookie } = await signIn('me@example.com', 'password123')
    expect(await sessionFor(cookie)).toBeNull()
    expect(await readSession(pageRequest(cookie))).toMatchObject({ twoFactorPending: true, user: { id: user.id } })
    expect(await getTwoFactorPendingUserId(pageRequest(cookie))).toBe(user.id)
  })

  it('completes when the session is updated with a ticket from verifySecondFactor', async () => {
    const { user, totp } = await userWithTotp()
    const { cookie } = await signIn('me@example.com', 'password123')
    const signedIn = await updateSession(cookie, { twoFactorTicket: await ticketFor(user.id, totp) })
    const session = await sessionFor(signedIn)
    expect(session?.user).toMatchObject({ id: user.id })
    expect(session).not.toHaveProperty('twoFactorPending')
    expect(await getTwoFactorPendingUserId(pageRequest(signedIn))).toBeNull()
  })

  it("stays pending with a made-up ticket or another user's", async () => {
    const { user } = await userWithTotp()
    const other = (await createUser('other@example.com', 'password123'))!
    const { cookie } = await signIn('me@example.com', 'password123')

    expect(await sessionFor(await updateSession(cookie, { twoFactorTicket: 'made-up' }))).toBeNull()
    const { secret } = await startTotpSetup(other.id)
    const otherTotp = new TOTP({ secret: Secret.fromBase32(secret) })
    await confirmTotpSetup(other.id, otherTotp.generate())
    const othersTicket = await ticketFor(other.id, otherTotp)
    const updated = await updateSession(cookie, { twoFactorTicket: othersTicket })
    expect(await sessionFor(updated)).toBeNull()
    expect(await getTwoFactorPendingUserId(pageRequest(updated))).toBe(user.id)
  })

  it('signs the user out if they take too long', async () => {
    const { user, totp } = await userWithTotp()
    const { cookie } = await signIn('me@example.com', 'password123')
    const ticket = await ticketFor(user.id, totp)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60_000 })
    try {
      const updated = await updateSession(cookie, { twoFactorTicket: ticket })
      expect(updated).not.toContain('session-token')
      expect(await readSession(pageRequest(cookie))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("isn't asked of users without it", async () => {
    await createUser('me@example.com', 'password123')
    const { cookie } = await signIn('me@example.com', 'password123')
    expect(await readSession(pageRequest(cookie))).not.toHaveProperty('twoFactorPending')
  })
})

describe('getSession', () => {
  it('is null without cookies or with a forged token', async () => {
    expect(await sessionFor('')).toBeNull()
    expect(await sessionFor('authjs.session-token=forged')).toBeNull()
  })
})

describe('the OAuth adapter', () => {
  it('finds users by email regardless of case, so OAuth sign-ins link to them', async () => {
    const user = await insertUser({ email: 'Mixed@Example.com' })
    expect(await authConfig.adapter!.getUserByEmail!('mixed@example.COM')).toMatchObject({ id: user.id })
    expect(await authConfig.adapter!.getUserByEmail!('other@example.com')).toBeNull()
  })

  it('stores new OAuth users with a lowercased email', async () => {
    const user = await authConfig.adapter!.createUser!({
      id: crypto.randomUUID(),
      email: 'New@Example.COM',
      emailVerified: null,
    })
    expect(user.email).toBe('new@example.com')
  })
})

describe('publicUrl', () => {
  it("rewrites the protocol and host to AUTH_URL's", async () => {
    vi.stubEnv('AUTH_URL', 'https://podnoms.example')
    vi.resetModules()
    try {
      const auth = await import('~/server/auth.server')
      expect(auth.publicUrl(new Request('http://internal/feed/x?y=1')).toString()).toBe('https://podnoms.example/feed/x?y=1')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('is the request URL when AUTH_URL is not set', () => {
    expect(publicUrl(new Request('http://internal:3000/feed/x?y=1')).toString()).toBe('http://internal:3000/feed/x?y=1')
  })

  it("rewrites the protocol, host and port to AUTH_URL's", async () => {
    vi.stubEnv('AUTH_URL', 'https://podnoms.example')
    vi.resetModules()
    try {
      const auth = await import('~/server/auth.server')
      expect(auth.publicUrl(new Request('http://internal:3000/feed/x?y=1')).toString()).toBe(
        'https://podnoms.example/feed/x?y=1',
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('oauthProviders', () => {
  it('is all off without keys', () => {
    expect(oauthProviders).toEqual({ github: false, google: false, facebook: false })
  })

  it('turns a provider on only when both its ID and secret are set', async () => {
    vi.stubEnv('AUTH_GITHUB_ID', 'id')
    vi.stubEnv('AUTH_GITHUB_SECRET', 'secret')
    vi.stubEnv('AUTH_GOOGLE_ID', 'id-only')
    vi.resetModules()
    try {
      const auth = await import('~/server/auth.server')
      expect(auth.oauthProviders).toEqual({ github: true, google: false, facebook: false })
      expect(auth.authConfig.providers.map((p) => (typeof p === 'function' ? p() : p).id)).toEqual([
        'credentials',
        'github',
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
