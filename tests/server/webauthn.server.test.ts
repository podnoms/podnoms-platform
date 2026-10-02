import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { securityKeys } from '~/server/db/schema'
import {
  finishKeyRegistration,
  startKeyAuthentication,
  startKeyRegistration,
  verifyKeyAuthentication,
} from '~/server/webauthn.server'
import { resetDb } from '../db'
import { fakeSecurityKey } from '../fake-authenticator'
import { createUser, db } from '../helpers'

const url = new URL('https://podnoms.example/security')
const origin = 'https://podnoms.example'

beforeEach(() => resetDb(db))

async function registerKey(userId: string, key = fakeSecurityKey()) {
  const options = await startKeyRegistration(userId, url)
  expect(await finishKeyRegistration(userId, 'My key', key.register(options, origin), url)).toBe(true)
  return key
}

describe('registering a security key', () => {
  it('stores the key for the user, for the public host', async () => {
    const user = await createUser({ email: 'me@example.com' })
    const options = await startKeyRegistration(user.id, url)
    expect(options).toMatchObject({ rp: { id: 'podnoms.example', name: 'podnoms' }, user: { name: 'me@example.com' } })
    expect(options).not.toHaveProperty('extensions')

    const key = fakeSecurityKey()
    expect(await finishKeyRegistration(user.id, 'YubiKey', key.register(options, origin), url)).toBe(true)
    const [stored] = await db.select().from(securityKeys).where(eq(securityKeys.userId, user.id))
    expect(stored).toMatchObject({ id: key.id, name: 'YubiKey', counter: 0, transports: ['usb'] })
  })

  it('excludes keys already registered', async () => {
    const user = await createUser()
    const key = await registerKey(user.id)
    const options = await startKeyRegistration(user.id, url)
    expect(options.excludeCredentials).toEqual([{ id: key.id, type: 'public-key', transports: ['usb'] }])
  })

  it('refuses a response made for another site', async () => {
    const user = await createUser()
    const options = await startKeyRegistration(user.id, url)
    const response = fakeSecurityKey().register(options, 'https://evil.example')
    expect(await finishKeyRegistration(user.id, 'Key', response, url)).toBe(false)
  })

  it('refuses a response without a challenge, or reusing one', async () => {
    const user = await createUser()
    const key = fakeSecurityKey()
    const options = await startKeyRegistration(user.id, url)
    const response = key.register(options, origin)
    expect(await finishKeyRegistration(user.id, 'Key', response, url)).toBe(true)
    expect(await finishKeyRegistration(user.id, 'Key', response, url)).toBe(false)
  })

  it('refuses a key registered to someone else', async () => {
    const [me, other] = [await createUser(), await createUser()]
    const key = await registerKey(other.id)
    const options = await startKeyRegistration(me.id, url)
    expect(await finishKeyRegistration(me.id, 'Key', key.register(options, origin), url)).toBe(false)
  })
})

describe('signing in with a security key', () => {
  it('is not offered to users without keys', async () => {
    const user = await createUser()
    expect(await startKeyAuthentication(user.id, url)).toBeNull()
  })

  it("accepts a signature from the user's key and records its use", async () => {
    const user = await createUser()
    const key = await registerKey(user.id)
    const options = (await startKeyAuthentication(user.id, url))!
    expect(options.allowCredentials).toEqual([{ id: key.id, type: 'public-key', transports: ['usb'] }])
    expect(await verifyKeyAuthentication(user.id, key.authenticate(options, origin), url)).toBe(true)

    const [stored] = await db.select().from(securityKeys).where(eq(securityKeys.id, key.id))
    expect(stored!.counter).toBe(1)
    expect(stored!.lastUsedAt).toBeInstanceOf(Date)
  })

  it('refuses a replayed response', async () => {
    const user = await createUser()
    const key = await registerKey(user.id)
    const response = key.authenticate((await startKeyAuthentication(user.id, url))!, origin)
    expect(await verifyKeyAuthentication(user.id, response, url)).toBe(true)
    await startKeyAuthentication(user.id, url)
    expect(await verifyKeyAuthentication(user.id, response, url)).toBe(false)
  })

  it('refuses a signature for another site', async () => {
    const user = await createUser()
    const key = await registerKey(user.id)
    const options = (await startKeyAuthentication(user.id, url))!
    expect(await verifyKeyAuthentication(user.id, key.authenticate(options, 'https://evil.example'), url)).toBe(false)
  })

  it("refuses another user's key", async () => {
    const [me, other] = [await createUser(), await createUser()]
    await registerKey(me.id)
    const otherKey = await registerKey(other.id)
    const options = (await startKeyAuthentication(me.id, url))!
    expect(await verifyKeyAuthentication(me.id, otherKey.authenticate(options, origin), url)).toBe(false)
  })

  it('refuses an unregistered key', async () => {
    const user = await createUser()
    await registerKey(user.id)
    const options = (await startKeyAuthentication(user.id, url))!
    expect(await verifyKeyAuthentication(user.id, fakeSecurityKey().authenticate(options, origin), url)).toBe(false)
  })
})
