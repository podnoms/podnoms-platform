// Auth.js configuration. `next-auth` itself only runs on Next.js, so this uses
// @auth/core, the framework-agnostic core that next-auth is built on.
import '@tanstack/react-start/server-only'
import { Auth, type AuthConfig } from '@auth/core'
import type { Adapter } from '@auth/core/adapters'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { sql } from 'drizzle-orm'
import Credentials from '@auth/core/providers/credentials'
import Facebook from '@auth/core/providers/facebook'
import GitHub from '@auth/core/providers/github'
import Google from '@auth/core/providers/google'
import type { Session } from '@auth/core/types'
import { env } from '~/env'
import { credentialsSchema } from '~/lib/auth-schema'
import { db } from '~/server/db/client.server'
import { accounts, sessions, users, verificationTokens } from '~/server/db/schema'
import { hasTwoFactor, redeemTwoFactorTicket } from '~/server/two-factor.server'
import { firstUserIsAdmin, verifyUser } from '~/server/users.server'

declare module '@auth/core/types' {
  interface Session {
    // Signed in, but yet to pass two-factor authentication.
    twoFactorPending?: boolean
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    // When a user with two-factor authentication on passed their first factor.
    twoFactorPendingSince?: number
  }
}

// How long a user has to pass their second factor before they're signed out.
const twoFactorTimeoutMs = 10 * 60_000

export const oauthProviders = {
  github: Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
  google: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  facebook: Boolean(env.AUTH_FACEBOOK_ID && env.AUTH_FACEBOOK_SECRET),
}

const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
})

// Emails are unique regardless of case (see the user table), so match them
// case-insensitively and store them lowercased. Otherwise an OAuth sign-in
// whose email differs only in case from an existing user would fail instead
// of linking.
const adapter: Adapter = {
  ...drizzleAdapter,
  createUser: (user) =>
    drizzleAdapter.createUser!({
      ...user,
      email: user.email.toLowerCase(),
      ...({ isAdmin: firstUserIsAdmin } as object),
    }),
  async getUserByEmail(email) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        image: users.image,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1)
    return user?.email ? { ...user, email: user.email } : null
  },
}

// Link an OAuth sign-in to the existing user with the same email, whichever
// method created that user. Auth.js calls this dangerous because it trusts the
// provider to have verified the email; that trade-off is accepted here.
const linkByEmail = { allowDangerousEmailAccountLinking: true }

export const authConfig: AuthConfig = {
  basePath: '/api/auth',
  secret: env.AUTH_SECRET,
  trustHost: true,
  // Stores OAuth users and their linked provider accounts.
  adapter,
  // The credentials provider only works with JWT sessions.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Users with two-factor authentication on get a session marked as pending,
    // whichever way they signed in. Updating the session (see updateSession in
    // auth-client.ts) with a ticket from verifySecondFactor clears the mark.
    async jwt({ token, user, trigger, session }) {
      if (trigger === 'signIn' && user?.id && (await hasTwoFactor(user.id))) {
        token.twoFactorPendingSince = Date.now()
      }
      if (token.twoFactorPendingSince) {
        if (Date.now() - token.twoFactorPendingSince > twoFactorTimeoutMs) return null
        if (trigger === 'update' && token.sub && redeemTwoFactorTicket(session?.twoFactorTicket, token.sub)) {
          delete token.twoFactorPendingSince
        }
      }
      return token
    },
    // Expose the database user id on the session; the JWT keeps it in `sub`.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (token.twoFactorPendingSince) session.twoFactorPending = true
      return session
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null
        const user = await verifyUser(parsed.data.email, parsed.data.password)
        return user && { id: user.id, email: user.email }
      },
    }),
    ...(oauthProviders.github
      ? [GitHub({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET, ...linkByEmail })]
      : []),
    ...(oauthProviders.google
      ? [Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET, ...linkByEmail })]
      : []),
    ...(oauthProviders.facebook
      ? [Facebook({ clientId: env.AUTH_FACEBOOK_ID, clientSecret: env.AUTH_FACEBOOK_SECRET, ...linkByEmail })]
      : []),
  ],
}

// Auth.js derives its URLs (OAuth callbacks, secure cookie names) from the
// request. Behind a proxy that doesn't forward the original protocol and host,
// set AUTH_URL to the public base URL and requests are rewritten to match it.
export function publicUrl(request: Request) {
  const url = new URL(request.url)
  if (env.AUTH_URL) {
    const base = new URL(env.AUTH_URL)
    url.protocol = base.protocol
    url.host = base.host
    // Setting `host` keeps the request's port when AUTH_URL has none.
    url.port = base.port
  }
  return url
}

export function handleAuthRequest(request: Request) {
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half',
  }
  return Auth(new Request(publicUrl(request), init), authConfig)
}

// The session, including one still pending two-factor authentication.
export async function readSession(request: Request): Promise<Session | null> {
  const url = new URL('/api/auth/session', publicUrl(request))
  const response = await Auth(
    new Request(url, { headers: { cookie: request.headers.get('cookie') ?? '' } }),
    authConfig,
  )
  const session = (await response.json()) as Session | null
  return session?.user ? session : null
}

// The session of a fully signed-in user: null while two-factor authentication
// is pending.
export async function getSession(request: Request): Promise<Session | null> {
  const session = await readSession(request)
  return session && !session.twoFactorPending ? session : null
}

// The user who has signed in but has yet to pass their second factor.
export async function getTwoFactorPendingUserId(request: Request) {
  const session = await readSession(request)
  return session?.twoFactorPending ? (session.user?.id ?? null) : null
}
