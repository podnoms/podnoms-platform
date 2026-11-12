import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { users } from '~/server/db/schema'
import { getSession, handleAuthRequest } from '~/server/auth.server'
import { createUser } from '~/server/users.server'
import {
  ReadOnlyError,
  hasViewAsCookie,
  readViewAsCookieValue,
  viewAsCookieName,
  viewAsCookieValue,
  viewAsMaxAgeSeconds,
} from '~/server/view-as.server'
import { resetDb } from '../db'
import { createUser as insertUser, db } from '../helpers'

const origin = 'http://localhost:5173'

beforeEach(() => resetDb(db))

function cookiesFrom(...responses: Response[]) {
  return responses
    .flatMap((response) => response.headers.getSetCookie())
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

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
  return cookiesFrom(csrf, response)
}

async function signedInAdmin() {
  const admin = (await createUser('admin@example.com', 'password123'))!
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id))
  return { admin, cookie: await signIn('admin@example.com', 'password123') }
}

const request = (cookie: string, method = 'GET') => new Request(`${origin}/`, { method, headers: { cookie } })
const withViewAs = (cookie: string, adminId: string, userId: string) =>
  `${cookie}; ${viewAsCookieName}=${viewAsCookieValue(adminId, userId)}`

describe('the view-as cookie', () => {
  it('reads back what was written', () => {
    expect(readViewAsCookieValue(viewAsCookieValue('a', 'u'))).toMatchObject({ adminId: 'a', userId: 'u' })
  })

  it('is refused once expired', () => {
    const value = viewAsCookieValue('a', 'u', Date.now() - viewAsMaxAgeSeconds * 1000 - 1)
    expect(readViewAsCookieValue(value)).toBeNull()
  })

  it('is refused when changed', () => {
    const [, signature] = viewAsCookieValue('a', 'u').split('.')
    const forged = Buffer.from(JSON.stringify({ adminId: 'a', userId: 'other', expires: Date.now() + 60_000 })).toString(
      'base64url',
    )
    expect(readViewAsCookieValue(`${forged}.${signature}`)).toBeNull()
    expect(readViewAsCookieValue('nonsense')).toBeNull()
  })

  it('is noticed whether or not it is valid', () => {
    expect(hasViewAsCookie(request(`${viewAsCookieName}=x`))).toBe(true)
    expect(hasViewAsCookie(request('other=1'))).toBe(false)
  })
})

describe('getSession while an admin views the site as a user', () => {
  it("gives the user's id, marked as viewed by the admin, to reads", async () => {
    const { admin, cookie } = await signedInAdmin()
    const user = await insertUser()
    const session = await getSession(request(withViewAs(cookie, admin.id, user.id)))
    expect(session?.user).toEqual({ id: user.id })
    expect(session?.viewAs).toEqual({ adminId: admin.id })
  })

  it('refuses anything that could change something', async () => {
    const { admin, cookie } = await signedInAdmin()
    const user = await insertUser()
    const viewing = withViewAs(cookie, admin.id, user.id)
    await expect(getSession(request(viewing, 'POST'))).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(getSession(request(viewing, 'DELETE'))).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(getSession(request(viewing), { write: true })).rejects.toBeInstanceOf(ReadOnlyError)
  })

  it("leaves the admin's own session alone without the cookie", async () => {
    const { admin, cookie } = await signedInAdmin()
    const session = await getSession(request(cookie, 'POST'), { write: true })
    expect(session?.user?.id).toBe(admin.id)
    expect(session?.viewAs).toBeUndefined()
  })

  it('ignores a cookie made for another admin', async () => {
    const { admin, cookie } = await signedInAdmin()
    const user = await insertUser()
    const session = await getSession(request(withViewAs(cookie, user.id, admin.id)))
    expect(session?.user?.id).toBe(admin.id)
  })

  it('ignores the cookie once the admin is no longer an admin', async () => {
    const { admin, cookie } = await signedInAdmin()
    const user = await insertUser()
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, admin.id))
    const session = await getSession(request(withViewAs(cookie, admin.id, user.id), 'POST'))
    expect(session?.user?.id).toBe(admin.id)
  })

  it('ignores the cookie for a user who no longer exists', async () => {
    const { admin, cookie } = await signedInAdmin()
    const user = await insertUser()
    await db.delete(users).where(eq(users.id, user.id))
    const session = await getSession(request(withViewAs(cookie, admin.id, user.id)))
    expect(session?.user?.id).toBe(admin.id)
  })

  it('does nothing for someone signed out', async () => {
    const admin = await insertUser({ isAdmin: true })
    const user = await insertUser()
    expect(await getSession(request(`${viewAsCookieName}=${viewAsCookieValue(admin.id, user.id)}`))).toBeNull()
  })
})
