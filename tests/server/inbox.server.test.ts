import { beforeEach, describe, expect, it } from 'vitest'
import { notifications } from '~/server/db/schema'
import {
  countUnread,
  inboxKeepDays,
  inboxPageSize,
  listNotifications,
  markNotificationsRead,
  pruneNotifications,
  recordNotification,
} from '~/server/inbox.server'
import { resetDb } from '../db'
import { createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const item = { kind: 'mention' as const, title: 'Ann mentioned you', body: 'Hi @you', url: '/show/episodes/one#comment-1' }

describe('inbox', () => {
  it("lists each user's own, newest first, and counts the unread", async () => {
    const ann = await createUser()
    const bob = await createUser()
    await recordNotification([ann.id, bob.id], item)
    await recordNotification([ann.id], { kind: 'live', title: 'The Show is live', url: '/live/the-show' })
    const { items, unread } = await listNotifications(ann.id)
    expect(unread).toBe(2)
    expect(items.map((notification) => notification.title)).toEqual(['The Show is live', 'Ann mentioned you'])
    expect(items[1]).toMatchObject({ ...item, image: null, read: false })
    expect(await countUnread(bob.id)).toBe(1)
  })

  it('marks some or all of them read, only for their owner', async () => {
    const ann = await createUser()
    const bob = await createUser()
    await recordNotification([ann.id], item)
    await recordNotification([ann.id], item)
    const [first] = (await listNotifications(ann.id)).items
    await markNotificationsRead(bob.id, [first!.id])
    expect(await countUnread(ann.id)).toBe(2)
    await markNotificationsRead(ann.id, [first!.id])
    expect(await countUnread(ann.id)).toBe(1)
    await markNotificationsRead(ann.id)
    expect(await countUnread(ann.id)).toBe(0)
    expect((await listNotifications(ann.id)).items.every((notification) => notification.read)).toBe(true)
  })

  it(`shows the newest ${inboxPageSize}`, async () => {
    const user = await createUser()
    for (let i = 0; i < inboxPageSize + 5; i++) await recordNotification([user.id], { ...item, title: `#${i}` })
    const { items, unread } = await listNotifications(user.id)
    expect(items).toHaveLength(inboxPageSize)
    expect(unread).toBe(inboxPageSize + 5)
  })

  it(`drops ones older than ${inboxKeepDays} days`, async () => {
    const user = await createUser()
    const now = new Date('2026-10-23T12:00:00Z')
    const day = 24 * 60 * 60 * 1000
    await db.insert(notifications).values([
      { userId: user.id, ...item, title: 'old', createdAt: new Date(now.getTime() - (inboxKeepDays + 1) * day) },
      { userId: user.id, ...item, title: 'recent', createdAt: new Date(now.getTime() - day) },
    ])
    expect(await pruneNotifications(now)).toBe(1)
    expect((await listNotifications(user.id)).items.map((notification) => notification.title)).toEqual(['recent'])
  })
})
