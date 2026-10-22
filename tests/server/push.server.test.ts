import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushSubscriptions, siteSettings } from '~/server/db/schema'
import {
  deletePushSubscription,
  getPushKeys,
  getPushSettings,
  pushKeysKey,
  resetPushKeys,
  savePushSubscription,
  sendPush,
  updatePushPrefs,
  type PushMessage,
} from '~/server/push.server'
import { getSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { createUser, db } from '../helpers'

const push = vi.hoisted(() => ({ sendNotification: vi.fn() }))
vi.mock('web-push', async (importOriginal) => {
  // A CommonJS module: the code under test uses its default export.
  const actual = await importOriginal<{ default: object }>()
  return { ...actual, default: { ...actual.default, sendNotification: push.sendNotification } }
})

const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const message: PushMessage = { title: 'The Show is live', body: 'Q&A night', url: '/live/the-show', icon: null, tag: 'live-p1' }

beforeEach(async () => {
  await resetDb(db)
  resetPushKeys()
  push.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
})

describe('push keys', () => {
  it('makes them once and keeps them, the private key encrypted, out of the site settings', async () => {
    const first = await getPushKeys()
    resetPushKeys()
    expect(await getPushKeys()).toEqual(first)
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, pushKeysKey))
    expect(JSON.stringify(row!.value)).not.toContain(first.privateKey)
    expect(Object.keys(await getSiteSettings())).not.toContain(pushKeysKey)
  })
})

describe('subscriptions', () => {
  it('names the browser, and moves a browser to whoever turned it on last', async () => {
    const first = await createUser()
    const second = await createUser()
    const subscription = { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }
    await savePushSubscription(first.id, subscription, firefox)
    await savePushSubscription(second.id, subscription, firefox)
    const rows = await db.select().from(pushSubscriptions)
    expect(rows.map((row) => [row.userId, row.label])).toEqual([[second.id, 'Firefox on Linux']])
  })

  it("only removes the user's own", async () => {
    const owner = await createUser()
    const other = await createUser()
    await savePushSubscription(owner.id, { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, null)
    const [row] = await db.select().from(pushSubscriptions)
    await deletePushSubscription(other.id, { id: row!.id })
    await deletePushSubscription(other.id, { endpoint: row!.endpoint })
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1)
    await deletePushSubscription(owner.id, { endpoint: row!.endpoint })
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })

  it("lists the user's choices and browsers for the settings page", async () => {
    const user = await createUser()
    await savePushSubscription(user.id, { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, firefox)
    await updatePushPrefs(user.id, { pushLive: false, pushNewEpisodes: true })
    expect(await getPushSettings(user.id)).toMatchObject({
      pushLive: false,
      pushNewEpisodes: true,
      devices: [{ label: 'Firefox on Linux', endpoint: 'https://push.example/a' }],
      publicKey: (await getPushKeys()).publicKey,
    })
  })
})

describe('sendPush', () => {
  it("sends to every one of the users' browsers", async () => {
    const user = await createUser()
    const other = await createUser()
    for (const endpoint of ['https://push.example/a', 'https://push.example/b'])
      await savePushSubscription(user.id, { endpoint, keys: { p256dh: 'p', auth: 'a' } }, null)
    await savePushSubscription(other.id, { endpoint: 'https://push.example/c', keys: { p256dh: 'p', auth: 'a' } }, null)
    await sendPush([user.id], message)
    const sent = push.sendNotification.mock.calls.map(([subscription, payload]) => [
      (subscription as { endpoint: string }).endpoint,
      JSON.parse(payload as string),
    ])
    expect(sent.sort()).toEqual([
      ['https://push.example/a', message],
      ['https://push.example/b', message],
    ])
  })

  it('forgets browsers the push service says have gone', async () => {
    const user = await createUser()
    await savePushSubscription(user.id, { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, null)
    const { WebPushError } = await import('web-push')
    push.sendNotification.mockRejectedValue(new WebPushError('Gone', 410, {}, '', 'https://push.example/a'))
    await sendPush([user.id], message)
    expect(await db.select().from(pushSubscriptions)).toEqual([])
  })
})
