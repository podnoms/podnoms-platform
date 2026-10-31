import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addComment } from '~/server/comments.server'
import { listNotifications } from '~/server/inbox.server'
import { emailCommentNotice } from '~/server/notifications.server'
import { sendPush } from '~/server/push.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

// What goes out by each channel is tested in push.server.test.ts and
// notifications.server.test.ts; here, who's told what.
vi.mock('~/server/push.server', () => ({ sendPush: vi.fn() }))
vi.mock('~/server/notifications.server', () => ({ emailCommentNotice: vi.fn() }))
vi.mock('~/server/email.server', () => ({ emailOrigin: () => 'https://pods.example' }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(sendPush).mockReset()
  vi.mocked(emailCommentNotice).mockReset()
})

// Lets the fire-and-forget notifying finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const ready = { status: 'ready' as const, audioUrl: '/audio', durationSeconds: 600 }

async function episodeOf(values: Parameters<typeof createEpisode>[1] = {}) {
  const owner = await createUser({ slug: 'owner' })
  const show = await createShow(owner.id, { title: 'The Show', slug: 'the-show' })
  const episode = await createEpisode(show.id, { title: 'Ep 1', slug: 'ep-1', ...ready, ...values })
  return { owner, episode }
}

const pushedTo = () => vi.mocked(sendPush).mock.calls.map(([userIds, message]) => [userIds[0], message.title])
const emailed = () => vi.mocked(emailCommentNotice).mock.calls.map(([userId, event]) => [userId, event.kind])

describe('comment notifications', () => {
  it('tells mentioned users, and the thread author they were replied to, but never the writer', async () => {
    const { episode } = await episodeOf()
    const ann = await createUser({ slug: 'ann', name: 'Ann' })
    const bob = await createUser({ slug: 'bob', name: 'Bob' })
    const cat = await createUser({ slug: 'cat', name: 'Cat' })
    const [top] = (await addComment(ann.id, episode.id, 'Top', 30))!
    await settle()
    vi.mocked(sendPush).mockReset()
    vi.mocked(emailCommentNotice).mockReset()

    await addComment(bob.id, episode.id, 'Agreed @cat, and @bob is me', 0, top!.id)
    await settle()
    expect(pushedTo().sort()).toEqual(
      [
        [ann.id, 'Bob replied to you'],
        [cat.id, 'Bob mentioned you'],
      ].sort(),
    )
    expect(emailed().sort()).toEqual(
      [
        [ann.id, 'reply'],
        [cat.id, 'mention'],
      ].sort(),
    )
    const [, message] = vi.mocked(sendPush).mock.calls[0]!
    expect(message.body).toBe('Agreed @cat, and @bob is me')
    expect(message.url).toMatch(/^\/the-show\/ep-1#comment-/)
    const [, event] = vi.mocked(emailCommentNotice).mock.calls[0]!
    expect(event).toMatchObject({ episodeTitle: 'Ep 1', showTitle: 'The Show', authorName: 'Bob' })
    expect(event.link).toMatch(/^https:\/\/pods\.example\/the-show\/ep-1#comment-/)
  })

  it('only sends desktop notifications to those who want them', async () => {
    const { episode } = await episodeOf()
    const writer = await createUser({ name: 'W' })
    const quiet = await createUser({ slug: 'quiet', pushMentions: false })
    await addComment(writer.id, episode.id, 'Hi @quiet', 0)
    await settle()
    expect(sendPush).not.toHaveBeenCalled()
    // The email side checks its own choice.
    expect(emailed()).toEqual([[quiet.id, 'mention']])
  })

  it("doesn't tell anyone who can't see the episode", async () => {
    const { owner, episode } = await episodeOf({ private: true })
    const outsider = await createUser({ slug: 'outsider' })
    await addComment(owner.id, episode.id, 'Hey @outsider', 0)
    await settle()
    expect(sendPush).not.toHaveBeenCalled()
    expect(emailCommentNotice).not.toHaveBeenCalled()
    expect(outsider).toBeTruthy()
  })
})

describe('the notifications menu', () => {
  it("gets mentions and replies whatever the user chose, but not about episodes they can't see", async () => {
    const { owner, episode } = await episodeOf()
    const writer = await createUser({ name: 'W' })
    const quiet = await createUser({ slug: 'quiet', pushMentions: false, emailMentions: false })
    await addComment(writer.id, episode.id, 'Hi @quiet', 0)
    await settle()
    expect((await listNotifications(quiet.id)).items).toMatchObject([{ kind: 'mention', title: 'W mentioned you', body: 'Hi @quiet' }])

    const hidden = await createEpisode(episode.showId, { slug: 'hidden', ...ready, private: true })
    await addComment(owner.id, hidden.id, 'Hey @quiet', 0)
    await settle()
    expect((await listNotifications(quiet.id)).items).toHaveLength(1)
  })
})
