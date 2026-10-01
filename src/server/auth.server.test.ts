import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authConfig, getSession, handleAuthRequest, oauthProviders, publicUrl } from '~/server/auth.server'
import { createUser } from '~/server/users.server'
import { resetDb } from '../../test/db'
import { createUser as insertUser, db } from '../../test/helpers'

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

const sessionFor = (cookie: string) => getSession(new Request(`${origin}/podcasts`, { headers: { cookie } }))

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

  // BUG: assigning url.host without a port keeps the request's port, so behind
  // a proxy on :3000 this gives https://podnoms.example:3000. Make this a plain
  // `it` once publicUrl also copies the port.
  it.fails("rewrites the protocol, host and port to AUTH_URL's", async () => {
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
