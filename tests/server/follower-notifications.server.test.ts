import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { podcastFollows } from '~/server/db/schema'
import {
  flushAllFollowerNotifications,
  listFollowNotify,
  newEpisodeMaxAgeMs,
  notifyFollowersLive,
  notifyFollowersNewEpisode,
  setFollowNotify,
} from '~/server/follower-notifications.server'
import { emailFollowedEpisodes, emailFollowerLive } from '~/server/notifications.server'
import { listNotifications } from '~/server/inbox.server'
import { sendPush } from '~/server/push.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

// What goes out by each channel is tested in push.server.test.ts and
// notifications.server.test.ts; here, who's told what.
vi.mock('~/server/push.server', () => ({ sendPush: vi.fn() }))
vi.mock('~/server/notifications.server', () => ({ emailFollowedEpisodes: vi.fn(), emailFollowerLive: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(sendPush).mockReset()
  vi.mocked(emailFollowedEpisodes).mockReset()
  vi.mocked(emailFollowerLive).mockReset()
})
afterEach(() => flushAllFollowerNotifications())

// Lets the fire-and-forget work finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function follower(podcastId: string, values: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(values)
  await db.insert(podcastFollows).values({ userId: user.id, podcastId })
  return user
}

async function show(values: Parameters<typeof createPodcast>[1] = {}) {
  const owner = await createUser()
  const podcast = await createPodcast(owner.id, { title: 'The Show', slug: 'the-show', imageUrl: '/images/show.jpg', ...values })
  return { owner, podcast }
}

describe('going live', () => {
  it('tells followers by each way they chose, not the owner or those who muted the podcast', async () => {
    const { owner, podcast } = await show()
    await db.insert(podcastFollows).values({ userId: owner.id, podcastId: podcast.id })
    const both = await follower(podcast.id, { emailLive: true })
    const pushOnly = await follower(podcast.id)
    const emailOnly = await follower(podcast.id, { pushLive: false, emailLive: true })
    const muted = await follower(podcast.id, { emailLive: true })
    await setFollowNotify(muted.id, podcast.id, false)

    notifyFollowersLive(podcast.id, 'Q&A night')
    await settle()

    const [pushedTo, message] = vi.mocked(sendPush).mock.calls[0]!
    expect(pushedTo.sort()).toEqual([both.id, pushOnly.id].sort())
    expect(message).toEqual({
      title: 'The Show is live',
      body: 'Q&A night',
      url: '/live/the-show',
      icon: '/images/show.jpg',
      tag: `live-${podcast.id}`,
    })
    const emailed = vi.mocked(emailFollowerLive).mock.calls
    expect(emailed.map(([userId]) => userId).sort()).toEqual([both.id, emailOnly.id].sort())
    expect(emailed[0]![1]).toMatchObject({ title: 'The Show', slug: 'the-show' })
    expect(emailed[0]![2]).toBe('Q&A night')
  })

  it('says nothing about a private podcast', async () => {
    const { podcast } = await show({ private: true })
    await follower(podcast.id, { emailLive: true })
    notifyFollowersLive(podcast.id, 'Secret')
    await settle()
    expect(sendPush).not.toHaveBeenCalled()
    expect(emailFollowerLive).not.toHaveBeenCalled()
  })
})

describe('new episodes', () => {
  async function readyEpisode(podcastId: string, values: Parameters<typeof createEpisode>[1] = {}) {
    return createEpisode(podcastId, { status: 'ready', audioUrl: '/audio', publishedAt: new Date(), ...values })
  }

  it('tells followers about an episode, linking to it', async () => {
    const { podcast } = await show()
    const user = await follower(podcast.id, { emailFollowedEpisodes: true })
    const episode = await readyEpisode(podcast.id, { title: 'Late Night Mix', slug: 'late-night' })
    notifyFollowersNewEpisode(episode.id, podcast.id, episode.publishedAt)
    await flushAllFollowerNotifications()

    expect(sendPush).toHaveBeenCalledExactlyOnceWith([user.id], {
      title: 'New from The Show',
      body: 'Late Night Mix',
      url: '/the-show/episodes/late-night',
      icon: '/images/show.jpg',
      tag: `episodes-${podcast.id}`,
    })
    expect(emailFollowedEpisodes).toHaveBeenCalledExactlyOnceWith(user.id, expect.objectContaining({ title: 'The Show' }), [
      { title: 'Late Night Mix', slug: 'late-night', imageUrl: null },
    ])
  })

  it("puts a few minutes' episodes from a podcast together, leaving out private and old ones", async () => {
    const { podcast } = await show()
    const wants = await follower(podcast.id)
    await follower(podcast.id, { pushNewEpisodes: false })
    const first = await readyEpisode(podcast.id, { title: 'One' })
    const second = await readyEpisode(podcast.id, { title: 'Two' })
    const hidden = await readyEpisode(podcast.id, { title: 'Hidden', private: true })
    const old = await readyEpisode(podcast.id, { title: 'Old', publishedAt: new Date(Date.now() - newEpisodeMaxAgeMs - 1000) })
    for (const episode of [first, second, hidden, old]) notifyFollowersNewEpisode(episode.id, podcast.id, episode.publishedAt)
    await flushAllFollowerNotifications()

    expect(sendPush).toHaveBeenCalledTimes(1)
    const [pushedTo, message] = vi.mocked(sendPush).mock.calls[0]!
    expect(pushedTo).toEqual([wants.id])
    expect([message.title, message.url]).toEqual(['2 new episodes from The Show', '/the-show'])
    expect(message.body).toMatch(/^(One · Two|Two · One)$/)
    // Email is off until chosen.
    expect(emailFollowedEpisodes).not.toHaveBeenCalled()
  })
})

describe('muting', () => {
  it("lists the podcasts the user follows, without others' private ones, and only mutes those", async () => {
    const { podcast } = await show()
    const { podcast: hidden } = await show({ title: 'Hidden', slug: 'hidden', private: true })
    const user = await follower(podcast.id)
    await db.insert(podcastFollows).values({ userId: user.id, podcastId: hidden.id })
    expect(await setFollowNotify(user.id, podcast.id, false)).toBe(true)
    expect(await setFollowNotify(user.id, crypto.randomUUID(), false)).toBe(false)
    expect(await listFollowNotify(user.id)).toEqual([
      { podcastId: podcast.id, title: 'The Show', slug: 'the-show', imageUrl: '/images/show.jpg', notify: false },
    ])
  })
})

describe('the notifications menu', () => {
  it("gets every follower's, whatever they chose for email and desktop, unless they muted the podcast", async () => {
    const { owner, podcast } = await show()
    await db.insert(podcastFollows).values({ userId: owner.id, podcastId: podcast.id })
    const quiet = await follower(podcast.id, { pushLive: false, emailLive: false })
    const muted = await follower(podcast.id)
    await setFollowNotify(muted.id, podcast.id, false)
    notifyFollowersLive(podcast.id, 'Q&A night')
    await settle()
    expect((await listNotifications(quiet.id)).items).toMatchObject([
      { kind: 'live', title: 'The Show is live', body: 'Q&A night', url: '/live/the-show', image: '/images/show.jpg' },
    ])
    expect((await listNotifications(muted.id)).items).toEqual([])
    expect((await listNotifications(owner.id)).items).toEqual([])
  })
})
