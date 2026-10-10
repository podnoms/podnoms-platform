import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchDelayMs,
  flushAllNotifications,
  notifyEpisodeFailed,
  notifyNewEpisodes,
} from '~/server/notifications.server'
import { renderEmail, type EmailMessage } from '~/server/emails.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

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
  const podcast = await createPodcast(user.id, { title: 'My Show', slug: 'my-show' })
  const episode = await createEpisode(podcast.id, { title: 'Ep 1', slug: 'ep-1', status: 'failed' })
  return { user, podcast, episode }
}

describe('notifications', () => {
  it('sends a few minutes of events as one email', async () => {
    const { podcast, episode } = await failedEpisode()
    notifyEpisodeFailed(episode.id, 'Video unavailable')
    notifyNewEpisodes(podcast.id, 2)
    await settle()
    expect(email.sendEmail).not.toHaveBeenCalled()

    await flushAllNotifications()
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [sent] = email.sendEmail.mock.calls[0]!
    expect(sent.to).toBe('owner@example.com')
    expect(sent.subject).toBe('1 episode failed, 2 new')
    const { text } = await renderEmail(sent, 'https://pods.example')
    expect(text).toContain('https://pods.example/podcasts/my-show/episodes/ep-1/manage')
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
    const { podcast, episode } = await failedEpisode({ notifyEpisodeFailed: false, notifyNewEpisodes: false })
    notifyEpisodeFailed(episode.id, null)
    notifyNewEpisodes(podcast.id, 3)
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
