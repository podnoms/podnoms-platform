import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contentReports, episodes, shows, users } from '~/server/db/schema'
import type { EmailMessage } from '~/server/emails.server'
import { listNotifications } from '~/server/inbox.server'
import {
  cloudflare,
  createReport,
  listOpenReports,
  maxReportsPerDay,
  resolveReport,
  type Reporter,
} from '~/server/reports.server'
import { imagePath, quarantinePath } from '~/server/storage.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db, exists, storeTestImage } from '../helpers'

const email = vi.hoisted(() => ({ sendEmail: vi.fn(async (_email: EmailMessage & { to: string }) => {}) }))
vi.mock('~/server/email.server', () => ({
  emailEnabled: async () => true,
  emailOrigin: () => 'https://pods.example',
  sendEmail: email.sendEmail,
}))

const site = vi.hoisted(() => ({ origin: null as string | null }))
vi.mock('~/server/site-url.server', () => ({ siteOrigin: () => site.origin }))

const visitor = (n = 1): Reporter => ({ userId: null, ip: `203.0.113.${n}`, userAgent: 'Firefox' })
// Lets the fire-and-forget alerts finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

let admin: Awaited<ReturnType<typeof createUser>>
let owner: Awaited<ReturnType<typeof createUser>>
let image: Awaited<ReturnType<typeof storeTestImage>>
let show: Awaited<ReturnType<typeof createShow>>

beforeEach(async () => {
  await resetDb(db)
  email.sendEmail.mockReset()
  admin = await createUser({ isAdmin: true, email: 'admin@example.com' })
  owner = await createUser({ name: 'Owner', email: 'owner@example.com' })
  image = await storeTestImage()
  show = await createShow(owner.id, { title: 'Pods', imageUrl: image.url })
})

afterEach(() => {
  site.origin = null
  cloudflare.zoneId = undefined
  cloudflare.token = undefined
  vi.unstubAllGlobals()
})

const report = (reason: 'childSafety' | 'sexual' | 'other' = 'sexual', who = visitor()) =>
  createReport(who, { targetKind: 'show', targetId: show.id, reason, details: null })

describe('createReport', () => {
  it('records a report of the image as it is now, with whose it is', async () => {
    expect(await report()).toBe(true)
    const [row] = await db.select().from(contentReports)
    expect(row).toMatchObject({ targetKind: 'show', imageUrl: image.url, ownerId: owner.id, reason: 'sexual' })
    expect(row!.reporterHash).not.toContain('203.0.113')
  })

  it('takes one report of an image a day from each visitor', async () => {
    expect(await report()).toBe(true)
    expect(await report()).toBe(false)
    expect(await report('other')).toBe(false)
    expect(await report('sexual', visitor(2))).toBe(true)
  })

  it('stops a visitor reporting too much', async () => {
    for (let n = 0; n < maxReportsPerDay; n++) {
      const other = await createShow(owner.id, { imageUrl: image.url })
      await createReport(visitor(), { targetKind: 'show', targetId: other.id, reason: 'other', details: null })
    }
    expect(await report()).toBe(false)
  })

  it("ignores reports of things without an image, or that don't exist", async () => {
    const plain = await createShow(owner.id)
    expect(await createReport(visitor(), { targetKind: 'show', targetId: plain.id, reason: 'other', details: null })).toBe(false)
    expect(await createReport(visitor(), { targetKind: 'user', targetId: 'nobody', reason: 'other', details: null })).toBe(false)
  })

  it('tells admins once per image and reason, emailing child safety reports', async () => {
    await report('sexual')
    await report('sexual', visitor(2))
    await settle()
    expect((await listNotifications(admin.id)).items).toHaveLength(1)
    expect(email.sendEmail).not.toHaveBeenCalled()

    await report('childSafety', visitor(3))
    await settle()
    expect((await listNotifications(admin.id)).items).toHaveLength(2)
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: 'Urgent: an image was reported as child abuse' }),
    )
  })
})

describe('listOpenReports', () => {
  it("groups an image's reports, newest first", async () => {
    await report('sexual')
    await report('childSafety', visitor(2))
    const [listed, ...rest] = await listOpenReports()
    expect(rest).toEqual([])
    expect(listed).toMatchObject({
      targetKind: 'show',
      imageUrl: image.url,
      what: 'the show “Pods”',
      path: `/${show.slug}`,
      owner: 'Owner (owner@example.com)',
      current: true,
      childSafety: true,
    })
    expect(listed!.reports.map((r) => r.reason).sort()).toEqual(['childSafety', 'sexual'])
  })

  it('says when the image has changed since', async () => {
    await report()
    await db.update(shows).set({ imageUrl: null }).where(eq(shows.id, show.id))
    expect(await listOpenReports()).toMatchObject([{ current: false }])
  })
})

describe('resolveReport', () => {
  const openReportId = async () => (await listOpenReports())[0]!.reportId

  it('removes the image, closing every report of it', async () => {
    await report()
    await report('other', visitor(2))
    expect(await resolveReport(admin.id, await openReportId(), 'removed')).toEqual({ purged: null })
    const [row] = await db.select({ imageUrl: shows.imageUrl }).from(shows).where(eq(shows.id, show.id))
    expect(row!.imageUrl).toBeNull()
    expect(await exists(image.path)).toBe(false)
    expect(await listOpenReports()).toEqual([])
    const rows = await db.select().from(contentReports)
    expect(rows.every((r) => r.resolution === 'removed' && r.resolvedById === admin.id)).toBe(true)
  })

  it('preserves a copy, with whose it was, before taking it down', async () => {
    await report('childSafety')
    const reportId = await openReportId()
    await resolveReport(admin.id, reportId, 'preserved')
    expect(await exists(quarantinePath(reportId))).toBe(true)
    expect(await exists(imagePath(image.imageId))).toBe(false)
    // Kept even once the account is gone.
    await db.delete(users).where(eq(users.id, owner.id))
    const [row] = await db.select().from(contentReports).where(eq(contentReports.id, reportId))
    expect(row).toMatchObject({
      resolution: 'preserved',
      ownerId: null,
      evidence: { ownerId: owner.id, ownerName: 'Owner', ownerEmail: 'owner@example.com', what: 'the show “Pods”' },
    })
  })

  it('leaves the image when dismissed', async () => {
    await report()
    expect(await resolveReport(admin.id, await openReportId(), 'dismissed')).toEqual({ purged: null })
    expect(await exists(image.path)).toBe(true)
    expect(await listOpenReports()).toEqual([])
  })

  it("only takes an episode's own image off it", async () => {
    const own = await storeTestImage()
    const episode = await createEpisode(show.id, { imageUrl: own.url })
    await createReport(visitor(), { targetKind: 'episode', targetId: episode.id, reason: 'other', details: null })
    await resolveReport(admin.id, await openReportId(), 'removed')
    const [row] = await db.select({ imageUrl: episodes.imageUrl }).from(episodes).where(eq(episodes.id, episode.id))
    expect(row!.imageUrl).toBeNull()
    expect(await exists(image.path)).toBe(true)
  })

  it('is null for reports already dealt with', async () => {
    await report()
    const reportId = await openReportId()
    await resolveReport(admin.id, reportId, 'dismissed')
    expect(await resolveReport(admin.id, reportId, 'removed')).toBeNull()
  })

  it("purges the image, every size, from Cloudflare's cache", async () => {
    site.origin = 'https://pods.example'
    cloudflare.zoneId = 'zone'
    cloudflare.token = 'token'
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true }))
    vi.stubGlobal('fetch', fetch)
    await report()
    expect(await resolveReport(admin.id, await openReportId(), 'removed')).toEqual({ purged: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone/purge_cache')
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer token')
    expect(JSON.parse(String(init!.body))).toEqual({ prefixes: [`pods.example${image.url}`] })
  })

  it("still takes the image down when Cloudflare can't purge it", async () => {
    site.origin = 'https://pods.example'
    cloudflare.zoneId = 'zone'
    cloudflare.token = 'token'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
    await report()
    expect(await resolveReport(admin.id, await openReportId(), 'removed')).toEqual({ purged: false })
    expect(await exists(image.path)).toBe(false)
  })
})
