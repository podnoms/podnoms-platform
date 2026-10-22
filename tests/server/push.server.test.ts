import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { podcastFollows, pushSubscriptions, siteSettings } from '~/server/db/schema'
import {
  deletePushSubscription,
  flushAllPushes,
  getPushKeys,
  getPushSettings,
  newEpisodeMaxAgeMs,
  notifyFollowersLive,
  notifyFollowersNewEpisode,
  pushKeysKey,
  resetPushKeys,
  savePushSubscription,
  setFollowNotify,
  updatePushPrefs,
  type PushMessage,
} from '~/server/push.server'
import { getSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

const push = vi.hoisted(() => ({ sendNotification: vi.fn() }))
vi.mock('web-push', async (importOriginal) => {
  // A CommonJS module: the code under test uses its default export.
  const actual = await importOriginal<{ default: object }>()
  return { ...actual, default: { ...actual.default, sendNotification: push.sendNotification } }
})

const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'

beforeEach(async () => {
  await resetDb(db)
  resetPushKeys()
  push.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
})
afterEach(() => flushAllPushes())

// Lets the fire-and-forget sends finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// The endpoint each notification went to, and what it said.
const sent = () =>
  push.sendNotification.mock.calls.map(([subscription, payload]) => ({
    endpoint: (subscription as { endpoint: string }).endpoint,
    message: JSON.parse(payload as string) as PushMessage,
  }))

let endpoints = 0
async function subscribedFollower(podcastId: string, userValues: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(userValues)
  await db.insert(podcastFollows).values({ userId: user.id, podcastId })
  const endpoint = `https://push.example/${++endpoints}`
  await savePushSubscription(user.id, { endpoint, keys: { p256dh: 'p256dh', auth: 'auth' } }, firefox)
  return { user, endpoint }
}

async function showWithOwner(values: Parameters<typeof createPodcast>[1] = {}) {
  const owner = await createUser()
  const podcast = await createPodcast(owner.id, { title: 'The Show', slug: 'the-show', imageUrl: '/images/show.jpg', ...values })
  return { owner, podcast }
}

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
})

describe('settings', () => {
  it("lists the user's choices, browsers and the podcasts they follow, without private ones", async () => {
    const { podcast } = await showWithOwner()
    const { podcast: hidden } = await showWithOwner({ title: 'Hidden', slug: 'hidden', private: true })
    const { user } = await subscribedFollower(podcast.id)
    await db.insert(podcastFollows).values({ userId: user.id, podcastId: hidden.id })
    await updatePushPrefs(user.id, { pushLive: false, pushNewEpisodes: true })
    expect(await setFollowNotify(user.id, podcast.id, false)).toBe(true)
    expect(await setFollowNotify(user.id, crypto.randomUUID(), false)).toBe(false)

    const settings = await getPushSettings(user.id)
    expect(settings).toMatchObject({
      pushLive: false,
      pushNewEpisodes: true,
      devices: [{ label: 'Firefox on Linux' }],
      follows: [{ podcastId: podcast.id, title: 'The Show', notify: false }],
      publicKey: (await getPushKeys()).publicKey,
    })
  })
})

describe('going live', () => {
  it('tells followers who want it, not the owner or those who muted the podcast or turned it off', async () => {
    const { owner, podcast } = await showWithOwner()
    const wanted = await subscribedFollower(podcast.id)
    const muted = await subscribedFollower(podcast.id)
    await setFollowNotify(muted.user.id, podcast.id, false)
    const turnedOff = await subscribedFollower(podcast.id, { pushLive: false })
    await db.insert(podcastFollows).values({ userId: owner.id, podcastId: podcast.id })
    await savePushSubscription(owner.id, { endpoint: 'https://push.example/owner', keys: { p256dh: 'p', auth: 'a' } }, null)
    expect(turnedOff).toBeTruthy()

    notifyFollowersLive(podcast.id, 'Q&A night')
    await settle()
    expect(sent()).toEqual([
      {
        endpoint: wanted.endpoint,
        message: { title: 'The Show is live', body: 'Q&A night', url: '/live/the-show', icon: '/images/show.jpg', tag: `live-${podcast.id}` },
      },
    ])
  })

  it('says nothing about a private podcast', async () => {
    const { podcast } = await showWithOwner({ private: true })
    await subscribedFollower(podcast.id)
    notifyFollowersLive(podcast.id, 'Secret')
    await settle()
    expect(push.sendNotification).not.toHaveBeenCalled()
  })

  it('forgets browsers the push service says have gone', async () => {
    const { podcast } = await showWithOwner()
    await subscribedFollower(podcast.id)
    const { WebPushError } = await import('web-push')
    push.sendNotification.mockRejectedValue(new WebPushError('Gone', 410, {}, '', 'https://push.example/1'))
    notifyFollowersLive(podcast.id, 'Live')
    await settle()
    expect(await db.select().from(pushSubscriptions)).toEqual([])
  })
})

describe('new episodes', () => {
  async function readyEpisode(podcastId: string, values: Parameters<typeof createEpisode>[1] = {}) {
    return createEpisode(podcastId, { status: 'ready', audioUrl: '/audio', publishedAt: new Date(), ...values })
  }

  it('sends one about an episode, linking to it', async () => {
    const { podcast } = await showWithOwner()
    const { endpoint } = await subscribedFollower(podcast.id)
    const episode = await readyEpisode(podcast.id, { title: 'Late Night Mix', slug: 'late-night' })
    notifyFollowersNewEpisode(episode.id, podcast.id, episode.publishedAt)
    await flushAllPushes()
    expect(sent()).toEqual([
      {
        endpoint,
        message: {
          title: 'New from The Show',
          body: 'Late Night Mix',
          url: '/the-show/episodes/late-night',
          icon: '/images/show.jpg',
          tag: `episodes-${podcast.id}`,
        },
      },
    ])
  })

  it("puts a few minutes' episodes from a podcast in one, leaving out private and old ones", async () => {
    const { podcast } = await showWithOwner()
    await subscribedFollower(podcast.id)
    await subscribedFollower(podcast.id, { pushNewEpisodes: false })
    const first = await readyEpisode(podcast.id, { title: 'One' })
    const second = await readyEpisode(podcast.id, { title: 'Two' })
    const hidden = await readyEpisode(podcast.id, { title: 'Hidden', private: true })
    const old = await readyEpisode(podcast.id, { title: 'Old', publishedAt: new Date(Date.now() - newEpisodeMaxAgeMs - 1000) })
    for (const episode of [first, second, hidden, old]) notifyFollowersNewEpisode(episode.id, podcast.id, episode.publishedAt)
    await flushAllPushes()
    expect(sent().map(({ message }) => [message.title, message.body, message.url])).toEqual([
      ['2 new episodes from The Show', expect.stringMatching(/^(One · Two|Two · One)$/), '/the-show'],
    ])
  })
})
