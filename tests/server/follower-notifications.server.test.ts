import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showFollows } from '~/server/db/schema'
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
import { sendAppPush } from '~/server/app-push.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

// What goes out by each channel is tested in push.server.test.ts and
// notifications.server.test.ts; here, who's told what.
vi.mock('~/server/push.server', () => ({ sendPush: vi.fn() }))
vi.mock('~/server/app-push.server', () => ({ sendAppPush: vi.fn() }))
vi.mock('~/server/notifications.server', () => ({ emailFollowedEpisodes: vi.fn(), emailFollowerLive: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(sendPush).mockReset()
  vi.mocked(sendAppPush).mockReset()
  vi.mocked(emailFollowedEpisodes).mockReset()
  vi.mocked(emailFollowerLive).mockReset()
})
afterEach(() => flushAllFollowerNotifications())

// Lets the fire-and-forget work finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function follower(showId: string, values: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(values)
  await db.insert(showFollows).values({ userId: user.id, showId })
  return user
}

async function makeShow(values: Parameters<typeof createShow>[1] = {}) {
  const owner = await createUser()
  const show = await createShow(owner.id, { title: 'The Show', slug: 'the-show', imageUrl: '/images/show.jpg', ...values })
  return { owner, show }
}

describe('going live', () => {
  it('tells followers by each way they chose, not the owner or those who muted the show', async () => {
    const { owner, show } = await makeShow()
    await db.insert(showFollows).values({ userId: owner.id, showId: show.id })
    const both = await follower(show.id, { emailLive: true })
    const pushOnly = await follower(show.id)
    const emailOnly = await follower(show.id, { pushLive: false, emailLive: true })
    const muted = await follower(show.id, { emailLive: true })
    await setFollowNotify(muted.id, show.id, false)

    notifyFollowersLive(show.id, 'Q&A night')
    await settle()

    const [pushedTo, message] = vi.mocked(sendPush).mock.calls[0]!
    expect(pushedTo.sort()).toEqual([both.id, pushOnly.id].sort())
    expect(message).toEqual({
      title: 'The Show is live',
      body: 'Q&A night',
      url: '/live/the-show',
      icon: '/images/show.jpg',
      tag: `live-${show.id}`,
    })
    const emailed = vi.mocked(emailFollowerLive).mock.calls
    expect(emailed.map(([userId]) => userId).sort()).toEqual([both.id, emailOnly.id].sort())
    expect(emailed[0]![1]).toMatchObject({ title: 'The Show', slug: 'the-show' })
    expect(emailed[0]![2]).toBe('Q&A night')
  })

  it('says nothing about a private show', async () => {
    const { show } = await makeShow({ private: true })
    await follower(show.id, { emailLive: true })
    notifyFollowersLive(show.id, 'Secret')
    await settle()
    expect(sendPush).not.toHaveBeenCalled()
    expect(emailFollowerLive).not.toHaveBeenCalled()
  })
})

describe('new episodes', () => {
  async function readyEpisode(showId: string, values: Parameters<typeof createEpisode>[1] = {}) {
    return createEpisode(showId, { status: 'ready', audioUrl: '/audio', publishedAt: new Date(), ...values })
  }

  it('tells followers about an episode, linking to it', async () => {
    const { show } = await makeShow()
    const user = await follower(show.id, { emailFollowedEpisodes: true })
    const episode = await readyEpisode(show.id, { title: 'Late Night Mix', slug: 'late-night' })
    notifyFollowersNewEpisode(episode.id, show.id, episode.publishedAt)
    await flushAllFollowerNotifications()

    expect(sendPush).toHaveBeenCalledExactlyOnceWith([user.id], {
      title: 'New from The Show',
      body: 'Late Night Mix',
      url: '/the-show/late-night',
      icon: '/images/show.jpg',
      tag: `episodes-${show.id}`,
    })
    expect(emailFollowedEpisodes).toHaveBeenCalledExactlyOnceWith(user.id, expect.objectContaining({ title: 'The Show' }), [
      expect.objectContaining({ title: 'Late Night Mix', slug: 'late-night', imageUrl: null }),
    ])
  })

  it("puts a few minutes' episodes from a show together, leaving out private and old ones", async () => {
    const { show } = await makeShow()
    const wants = await follower(show.id)
    await follower(show.id, { pushNewEpisodes: false })
    const first = await readyEpisode(show.id, { title: 'One' })
    const second = await readyEpisode(show.id, { title: 'Two' })
    const hidden = await readyEpisode(show.id, { title: 'Hidden', private: true })
    const old = await readyEpisode(show.id, { title: 'Old', publishedAt: new Date(Date.now() - newEpisodeMaxAgeMs - 1000) })
    for (const episode of [first, second, hidden, old]) notifyFollowersNewEpisode(episode.id, show.id, episode.publishedAt)
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
  it("lists the shows the user follows, without others' private ones, and only mutes those", async () => {
    const { show } = await makeShow()
    const { show: hidden } = await makeShow({ title: 'Hidden', slug: 'hidden', private: true })
    const user = await follower(show.id)
    await db.insert(showFollows).values({ userId: user.id, showId: hidden.id })
    expect(await setFollowNotify(user.id, show.id, false)).toBe(true)
    expect(await setFollowNotify(user.id, crypto.randomUUID(), false)).toBe(false)
    expect(await listFollowNotify(user.id)).toEqual([
      { showId: show.id, title: 'The Show', slug: 'the-show', imageUrl: '/images/show.jpg', notify: false },
    ])
  })
})

describe('the notifications menu', () => {
  it("gets every follower's, whatever they chose for email and desktop, unless they muted the show", async () => {
    const { owner, show } = await makeShow()
    await db.insert(showFollows).values({ userId: owner.id, showId: show.id })
    const quiet = await follower(show.id, { pushLive: false, emailLive: false })
    const muted = await follower(show.id)
    await setFollowNotify(muted.id, show.id, false)
    notifyFollowersLive(show.id, 'Q&A night')
    await settle()
    expect((await listNotifications(quiet.id)).items).toMatchObject([
      { kind: 'live', title: 'The Show is live', body: 'Q&A night', url: '/live/the-show', image: '/images/show.jpg' },
    ])
    expect((await listNotifications(muted.id)).items).toEqual([])
    expect((await listNotifications(owner.id)).items).toEqual([])
  })
})

describe('on the mobile app', () => {
  it('sends going live to those who chose it, opening the live page, apart from desktop choices', async () => {
    const { show } = await makeShow()
    const yes = await follower(show.id, { pushLive: false })
    await follower(show.id, { appPushLive: false })
    notifyFollowersLive(show.id, 'Tonight')
    await settle()
    expect(vi.mocked(sendAppPush).mock.calls[0]).toEqual([
      expect.arrayContaining([yes.id]),
      { title: 'The Show is live', body: 'Tonight', path: '/live/the-show', channel: 'live' },
    ])
    expect(vi.mocked(sendAppPush).mock.calls[0]![0]).toHaveLength(1)
  })

  it('skips muted and private shows', async () => {
    const { show } = await makeShow()
    const muted = await follower(show.id)
    await setFollowNotify(muted.id, show.id, false)
    const { show: hidden } = await makeShow({ slug: 'hidden', private: true })
    await follower(hidden.id)
    notifyFollowersLive(show.id, 'Tonight')
    notifyFollowersLive(hidden.id, 'Tonight')
    await settle()
    expect(vi.mocked(sendAppPush).mock.calls).toEqual([[[], expect.anything()]])
  })

  it('opens the episode for one new episode, and the show for several', async () => {
    const { show } = await makeShow()
    const fan = await follower(show.id)
    await follower(show.id, { appPushNewEpisodes: false })
    const one = await createEpisode(show.id, { title: 'One', status: 'ready', audioUrl: '/a' })
    notifyFollowersNewEpisode(one.id, show.id, null)
    await flushAllFollowerNotifications()
    expect(vi.mocked(sendAppPush).mock.calls[0]).toEqual([
      [fan.id],
      { title: 'New from The Show', body: 'One', path: `/episodes/${one.id}`, channel: 'episodes' },
    ])

    const two = await createEpisode(show.id, { title: 'Two', status: 'ready', audioUrl: '/b' })
    notifyFollowersNewEpisode(one.id, show.id, null)
    notifyFollowersNewEpisode(two.id, show.id, null)
    await flushAllFollowerNotifications()
    expect(vi.mocked(sendAppPush).mock.calls[1]![1]).toMatchObject({ title: '2 new episodes from The Show', path: '/shows/the-show' })
  })
})
