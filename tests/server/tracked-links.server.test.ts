import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodes, trackedLinks } from '~/server/db/schema'
import {
  createTrackedLink,
  deleteTrackedLink,
  listTrackedLinks,
  recordTrackedLinkVisit,
} from '~/server/tracked-links.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

const chrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const visitor = { userAgent: chrome, viewerId: null }

beforeEach(() => resetDb(db))

async function setup() {
  const owner = await createUser()
  const show = await createShow(owner.id)
  const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/api/episodes/x/audio' })
  return { owner, episode }
}

async function tokenOf(id: string) {
  const [row] = await db.select({ token: trackedLinks.token }).from(trackedLinks).where(eq(trackedLinks.id, id))
  expect(row).toBeDefined()
  return row!.token
}

describe('tracked links', () => {
  it('makes, lists and deletes links for the owner only', async () => {
    const { owner, episode } = await setup()
    const stranger = await createUser()
    await expect(createTrackedLink(stranger.id, episode.id, 'Alex')).rejects.toThrow()

    const { id } = await createTrackedLink(owner.id, episode.id, 'Alex')
    expect(await listTrackedLinks(owner.id, episode.id)).toMatchObject([{ id, label: 'Alex', openCount: 0, playCount: 0 }])
    expect(await listTrackedLinks(stranger.id, episode.id)).toEqual([])

    expect(await deleteTrackedLink(stranger.id, id)).toBe(false)
    expect(await deleteTrackedLink(owner.id, id)).toBe(true)
    expect(await listTrackedLinks(owner.id, episode.id)).toEqual([])
  })

  it('counts opens and plays', async () => {
    const { owner, episode } = await setup()
    const { id } = await createTrackedLink(owner.id, episode.id, 'Alex')
    const token = await tokenOf(id)

    expect(await recordTrackedLinkVisit(token, { type: 'open', episodeId: episode.id }, visitor)).toBe(true)
    const [first] = await listTrackedLinks(owner.id, episode.id)
    expect(first).toMatchObject({ openCount: 1, playCount: 0, lastPlayedAt: null })
    expect(first!.firstOpenedAt).toBeInstanceOf(Date)

    await recordTrackedLinkVisit(token, { type: 'open', episodeId: episode.id }, visitor)
    await recordTrackedLinkVisit(token, { type: 'play', episodeId: episode.id }, visitor)
    const [link] = await listTrackedLinks(owner.id, episode.id)
    expect(link).toMatchObject({ openCount: 2, playCount: 1 })
    expect(link!.firstOpenedAt).toEqual(first!.firstOpenedAt)
    expect(link!.lastPlayedAt).toBeInstanceOf(Date)
  })

  it("doesn't count the owner, crawlers, or a token used for another episode", async () => {
    const { owner, episode } = await setup()
    const other = await createEpisode(episode.showId, { status: 'ready' })
    const { id } = await createTrackedLink(owner.id, episode.id, 'Alex')
    const token = await tokenOf(id)

    const open = { type: 'open', episodeId: episode.id } as const
    expect(await recordTrackedLinkVisit(token, open, { userAgent: chrome, viewerId: owner.id })).toBe(false)
    expect(await recordTrackedLinkVisit(token, open, { userAgent: 'Slackbot-LinkExpanding 1.0', viewerId: null })).toBe(false)
    expect(await recordTrackedLinkVisit(token, { type: 'open', episodeId: other.id }, visitor)).toBe(false)
    expect(await recordTrackedLinkVisit('nope', open, visitor)).toBe(false)
    expect(await listTrackedLinks(owner.id, episode.id)).toMatchObject([{ openCount: 0 }])
  })

  it('goes with its episode', async () => {
    const { owner, episode } = await setup()
    await createTrackedLink(owner.id, episode.id, 'Alex')
    await db.delete(episodes).where(eq(episodes.id, episode.id))
    expect(await db.select().from(trackedLinks)).toEqual([])
  })
})
