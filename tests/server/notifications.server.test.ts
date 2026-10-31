import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchDelayMs,
  emailFollowedEpisodes,
  emailFollowerLive,
  flushAllNotifications,
  notifyEpisodeFailed,
  notifyNewEpisodes,
} from '~/server/notifications.server'
import { renderEmail, type EmailMessage } from '~/server/emails.server'
import { resetDb } from '../db'
import { listNotifications } from '~/server/inbox.server'
import { createEpisode, createShow, createUser, db } from '../helpers'

const email = vi.hoisted(() => ({
  enabled: true,
  sendEmail: vi.fn(async (_email: EmailMessage & { to: string }) => {}),
}))
vi.mock('~/server/email.server', () => ({
  emailEnabled: async () => email.enabled,
  emailOrigin: () => 'https://pods.example',
  sendEmail: email.sendEmail,
}))
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('~/server/logger.server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportError,
}))

beforeEach(async () => {
  await resetDb(db)
  email.enabled = true
  email.sendEmail.mockReset()
  reportError.mockClear()
})
afterEach(async () => {
  await flushAllNotifications()
  vi.useRealTimers()
})

// Lets the fire-and-forget lookups finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function failedEpisode(userValues: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser({ email: 'owner@example.com', ...userValues })
  const show = await createShow(user.id, { title: 'My Show', slug: 'my-show' })
  const episode = await createEpisode(show.id, { title: 'Ep 1', slug: 'ep-1', status: 'failed' })
  return { user, show, episode }
}

describe('notifications', () => {
  it('sends a few minutes of events as one email', async () => {
    const { show, episode } = await failedEpisode()
    notifyEpisodeFailed(episode.id, 'Video unavailable')
    notifyNewEpisodes(show.id, 2)
    await settle()
    expect(email.sendEmail).not.toHaveBeenCalled()

    await flushAllNotifications()
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [sent] = email.sendEmail.mock.calls[0]!
    expect(sent.to).toBe('owner@example.com')
    expect(sent.subject).toBe('1 episode failed, 2 new')
    const { text } = await renderEmail(sent, 'https://pods.example')
    expect(text).toContain('https://pods.example/my-show/ep-1/manage')
  })

  it('sends after the batch delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true })
    const { episode } = await failedEpisode()
    notifyEpisodeFailed(episode.id, null)
    await vi.advanceTimersByTimeAsync(100)
    expect(email.sendEmail).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(batchDelayMs)
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })

  it("respects the owner's choices", async () => {
    const { show, episode } = await failedEpisode({ notifyEpisodeFailed: false, notifyNewEpisodes: false })
    notifyEpisodeFailed(episode.id, null)
    notifyNewEpisodes(show.id, 3)
    await settle()
    await flushAllNotifications()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it("sends nothing when the site can't send email", async () => {
    email.enabled = false
    const { episode } = await failedEpisode()
    notifyEpisodeFailed(episode.id, null)
    await settle()
    await flushAllNotifications()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('reports a failure to send instead of throwing', async () => {
    email.sendEmail.mockRejectedValueOnce(new Error('SMTP down'))
    const { episode } = await failedEpisode()
    notifyEpisodeFailed(episode.id, null)
    await settle()
    await flushAllNotifications()
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'SMTP down' }), expect.anything())
  })
})

describe('emails about shows the user follows', () => {
  const show = { title: 'Loved', slug: 'loved' }

  it('adds new episodes to the next email, if the user chose them', async () => {
    const wants = await createUser({ email: 'wants@example.com', emailFollowedEpisodes: true })
    const not = await createUser({ email: 'not@example.com' })
    for (const user of [wants, not]) emailFollowedEpisodes(user.id, show, [{ title: 'Late Night Mix', slug: 'late-night' }])
    await settle()
    expect(email.sendEmail).not.toHaveBeenCalled()
    await flushAllNotifications()
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [sent] = email.sendEmail.mock.calls[0]!
    expect(sent.to).toBe('wants@example.com')
    expect(sent.subject).toBe('New from Loved: Late Night Mix')
    const { text } = await renderEmail(sent, 'https://pods.example')
    expect(text).toContain('https://pods.example/loved/late-night')
  })

  it('sends going live at once, if the user chose it', async () => {
    const wants = await createUser({ email: 'wants@example.com', emailLive: true })
    const not = await createUser({ email: 'not@example.com' })
    for (const user of [wants, not]) emailFollowerLive(user.id, show, 'Q&A night')
    await settle()
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [sent] = email.sendEmail.mock.calls[0]!
    expect([sent.to, sent.subject]).toEqual(['wants@example.com', 'Loved is live now'])
  })
})

describe('the notifications menu', () => {
  it("gets owners' notices even when they're not emailed", async () => {
    const { user, episode } = await failedEpisode({ notifyEpisodeFailed: false })
    email.enabled = false
    notifyEpisodeFailed(episode.id, 'Video unavailable')
    await settle()
    expect((await listNotifications(user.id)).items).toMatchObject([
      { kind: 'episodeFailed', title: 'Ep 1 couldn’t be processed', body: 'Video unavailable', url: '/my-show/ep-1/manage' },
    ])
  })
})
