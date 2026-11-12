// Admins viewing the site as another user sees it, read-only (the View as
// button in the Users table at /admin). The admin's browser holds a signed
// cookie naming them and the user; getSession (auth.server.ts) then gives the
// user's id in place of theirs, but only to GET and HEAD requests, so nothing
// can be changed in the user's name. The cookie counts only alongside the
// session of the admin it names, and only while they're still an admin.
import '@tanstack/react-start/server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { users } from '~/server/db/schema'
import { signingKey } from '~/server/secrets.server'
import { isAdmin } from '~/server/users.server'

export const viewAsCookieName = 'podnoms-view-as'
export const viewAsMaxAgeSeconds = 60 * 60

export class ReadOnlyError extends Error {
  override name = 'ReadOnlyError'
  constructor() {
    super("You're viewing the site as someone else, which is read-only. Stop viewing as them to make changes.")
  }
}

type ViewAs = { adminId: string; userId: string; expires: number }

function sign(payload: string) {
  return createHmac('sha256', signingKey('podnoms view as')).update(payload).digest('base64url')
}

// The cookie's value: "<payload>.<signature>", the payload base64url JSON.
export function viewAsCookieValue(adminId: string, userId: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ adminId, userId, expires: now + viewAsMaxAgeSeconds * 1000 } satisfies ViewAs),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readViewAsCookieValue(value: string | undefined, now = Date.now()): ViewAs | null {
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ViewAs
    return typeof parsed.adminId === 'string' && typeof parsed.userId === 'string' && parsed.expires > now
      ? parsed
      : null
  } catch {
    return null
  }
}

function cookieValue(request: Request) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === viewAsCookieName) return decodeURIComponent(value.join('='))
  }
  return undefined
}

// Whether the request carries the cookie at all, valid or not: enough for
// leaving things uncounted (plays, downloads, tracked link opens).
export function hasViewAsCookie(request: Request) {
  return cookieValue(request) !== undefined
}

// The user whom the signed-in user (an admin) is viewing the site as, if any.
export async function viewedUserId(request: Request, signedInUserId: string) {
  const viewAs = readViewAsCookieValue(cookieValue(request))
  if (!viewAs || viewAs.adminId !== signedInUserId || viewAs.userId === signedInUserId) return null
  if (!(await isAdmin(signedInUserId))) return null
  return (await userExists(viewAs.userId)) ? viewAs.userId : null
}

export async function userExists(userId: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  return Boolean(user)
}

// Whether this request may act as the user being viewed: only reading.
export function isReadRequest(request: Request) {
  return request.method === 'GET' || request.method === 'HEAD'
}
