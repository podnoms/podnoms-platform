import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import { z } from 'zod'

// Spaces are allowed, as some apps show codes as "123 456".
export const totpCodeSchema = z
  .string()
  .transform((code) => code.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your app'))

export const recoveryCodeSchema = z
  .string()
  .trim()
  .pipe(z.string().regex(/^[a-z2-7]{5}-?[a-z2-7]{5}$/i, 'Enter one of your recovery codes, like abcde-fgh23'))

// WebAuthn responses are checked in full by @simplewebauthn/server; this only
// makes sure one looks like a credential.
const credentialShape = z.looseObject({ id: z.string().min(1).max(1024), response: z.looseObject({}) })
const isCredential = (value: unknown) => credentialShape.safeParse(value).success
export const registrationResponseSchema = z.custom<RegistrationResponseJSON>(isCredential, 'Invalid credential')
export const authenticationResponseSchema = z.custom<AuthenticationResponseJSON>(isCredential, 'Invalid credential')

export const securityKeyNameSchema = z.string().trim().min(1, 'Give the key a name').max(60)

export const secondFactorSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('totp'), code: totpCodeSchema }),
  z.object({ method: z.literal('recovery'), code: recoveryCodeSchema }),
  z.object({ method: z.literal('securityKey'), response: authenticationResponseSchema }),
])
