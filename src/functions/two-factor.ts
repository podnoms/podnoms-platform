import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  registrationResponseSchema,
  secondFactorSchema,
  securityKeyNameSchema,
  totpCodeSchema,
} from '~/lib/two-factor-schema'
import { getSession, getTwoFactorPendingUserId } from '~/server/auth.server'
import { publicUrl } from '~/server/site-url.server'
import {
  confirmTotpSetup,
  disableTotp,
  ensureRecoveryCodes,
  getTwoFactorStatus,
  hasTwoFactor,
  regenerateRecoveryCodes,
  removeSecurityKey,
  startTotpSetup,
  verifySecondFactor,
} from '~/server/two-factor.server'
import { finishKeyRegistration, startKeyAuthentication, startKeyRegistration } from '~/server/webauthn.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// For signing in: the user who has passed their password or OAuth sign-in
// but not yet their second factor.
async function requirePendingUserId() {
  const userId = await getTwoFactorPendingUserId(getRequest())
  if (!userId) throw new Error('There is no sign-in waiting for two-factor authentication')
  return userId
}

// --- Settings -----------------------------------------------------------------

export const fetchTwoFactorStatus = createServerFn({ method: 'GET' }).handler(async () =>
  getTwoFactorStatus(await requireUserId()),
)

export const beginTotpSetup = createServerFn({ method: 'POST' }).handler(async () =>
  startTotpSetup(await requireUserId()),
)

export const finishTotpSetup = createServerFn({ method: 'POST' })
  .validator(z.object({ code: totpCodeSchema }))
  .handler(async ({ data }) => confirmTotpSetup(await requireUserId(), data.code))

export const removeTotp = createServerFn({ method: 'POST' }).handler(async () => {
  await disableTotp(await requireUserId())
})

export const beginSecurityKeySetup = createServerFn({ method: 'POST' }).handler(async () =>
  startKeyRegistration(await requireUserId(), publicUrl(getRequest())),
)

export const finishSecurityKeySetup = createServerFn({ method: 'POST' })
  .validator(z.object({ name: securityKeyNameSchema, response: registrationResponseSchema }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    if (!(await finishKeyRegistration(userId, data.name, data.response, publicUrl(getRequest())))) {
      return { ok: false as const, error: "That key couldn't be registered. It may already be added." }
    }
    return { ok: true as const, recoveryCodes: await ensureRecoveryCodes(userId) }
  })

export const deleteSecurityKey = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await removeSecurityKey(await requireUserId(), data.id)
  })

export const newRecoveryCodes = createServerFn({ method: 'POST' }).handler(async () => {
  const userId = await requireUserId()
  if (!(await hasTwoFactor(userId))) throw new Error('Turn on two-factor authentication first')
  return regenerateRecoveryCodes(userId)
})

// --- Signing in ---------------------------------------------------------------

export const beginSecurityKeyChallenge = createServerFn({ method: 'POST' }).handler(async () => {
  const options = await startKeyAuthentication(await requirePendingUserId(), publicUrl(getRequest()))
  if (!options) throw new Error('You have no security keys')
  return options
})

// On success, pass the ticket to updateSession (auth-client.ts) to finish signing in.
export const verifyTwoFactor = createServerFn({ method: 'POST' })
  .validator(secondFactorSchema)
  .handler(async ({ data }) => verifySecondFactor(await requirePendingUserId(), data, publicUrl(getRequest())))
