import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { liveEmail, notificationDigestEmail, passwordResetEmail, renderEmail, testEmail } from '~/server/emails.server'

const origin = 'https://pods.example'

describe('renderEmail', () => {
  it("puts every email in the site's layout, with its icon and name", async () => {
    const { html, text } = await renderEmail(testEmail(), origin)
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('src="cid:logo@podnoms"')
    expect(html).toContain(`href="${origin}"`)
    expect(html).toContain('Robot powered podcasts')
    // Headings come out in capitals in plain text.
    expect(text).toContain('EMAIL IS WORKING')
    expect(text).not.toContain('<')
    expect(text.startsWith('podnoms')).toBe(true)
  })

  it('attaches the site icon from public/logo.png, small, for the layout to show', async () => {
    const { attachments } = await renderEmail(testEmail(), origin)
    expect(attachments).toEqual([
      { filename: 'logo.png', content: expect.any(Buffer), cid: 'logo@podnoms', contentDisposition: 'inline' },
    ])
    const { width, format } = await sharp(attachments[0]!.content).metadata()
    expect({ width, format }).toEqual({ width: 72, format: 'png' })
  })

  it('still shows the icon without an origin, just not as a link', async () => {
    const { html } = await renderEmail(testEmail(), null)
    expect(html).toContain('src="cid:logo@podnoms"')
    expect(html).not.toContain('href="https://pods.example"')
  })

  it('shows the preview line to inboxes', async () => {
    const message = testEmail()
    const { html } = await renderEmail(message, origin)
    expect(html).toContain(message.preview)
  })
})

describe('passwordResetEmail', () => {
  it('links to the reset page in both versions', async () => {
    const link = 'https://pods.example/reset-password?token=abc'
    const message = passwordResetEmail(link)
    expect(message.subject).toBe('Reset your podnoms password')
    const { html, text } = await renderEmail(message, origin)
    expect(html).toContain(`href="${link}"`)
    expect(text).toContain(link)
  })
})

describe('notificationDigestEmail', () => {
  const events = [
    { type: 'episodeFailed' as const, podcastTitle: '<Show>', episodeTitle: 'Ep & 1', error: 'Gone', link: 'https://pods.example/e' },
    { type: 'newEpisodes' as const, podcastTitle: 'Other', count: 3, link: null },
  ]

  it('sums the events up in the subject', () => {
    expect(notificationDigestEmail(events, null).subject).toBe('1 episode failed, 3 new')
    const failures = [events[0]!, { ...events[0]!, episodeTitle: 'Ep 2' }]
    expect(notificationDigestEmail(failures, null).subject).toBe('2 episodes couldn’t be processed')
    expect(notificationDigestEmail([events[0]!], null).subject).toBe('An episode couldn’t be processed')
    expect(notificationDigestEmail([events[1]!], null).subject).toBe('3 new episodes on podnoms')
  })

  it("leads with the user's own podcasts, then sums up the ones they follow", () => {
    const followed = { type: 'followedEpisodes' as const, podcastTitle: 'Loved', titles: ['Late Night Mix'], link: null }
    expect(notificationDigestEmail([followed, events[1]!], null).subject).toBe('3 new episodes on podnoms')
    expect(notificationDigestEmail([followed], null).subject).toBe('New from Loved: Late Night Mix')
    expect(notificationDigestEmail([followed, { ...followed, titles: ['A', 'B'] }], null).subject).toBe(
      '3 new episodes from podcasts you follow',
    )
  })

  it('says who mentioned or replied to the user', async () => {
    const comment = {
      type: 'comment' as const,
      kind: 'mention' as const,
      authorName: 'Ann',
      episodeTitle: 'Ep 1',
      podcastTitle: 'Show',
      excerpt: 'Hey @you',
      link: `${origin}/show/episodes/ep-1#comment-1`,
    }
    expect(notificationDigestEmail([comment], null).subject).toBe('Ann mentioned you')
    expect(notificationDigestEmail([{ ...comment, kind: 'reply' }], null).subject).toBe('Ann replied to you')
    expect(notificationDigestEmail([comment, comment], null).subject).toBe('2 mentions and replies on podnoms')
    const { text } = await renderEmail(notificationDigestEmail([comment], null), origin)
    expect(text).toContain('Hey @you')
    expect(text).toContain(`${origin}/show/episodes/ep-1#comment-1`)
  })

  it('lists the episodes of a podcast the user follows', async () => {
    const followed = { type: 'followedEpisodes' as const, podcastTitle: 'Loved', titles: ['One', 'Two'], link: `${origin}/loved` }
    const { text } = await renderEmail(notificationDigestEmail([followed], null), origin)
    expect(text).toContain('2 new episodes from Loved')
    expect(text).toContain('One · Two')
    expect(text).toContain(`${origin}/loved`)
  })

  it('lists every event, escaping titles in the HTML', async () => {
    const { html, text } = await renderEmail(notificationDigestEmail(events, `${origin}/settings/notifications`), origin)
    expect(text).toContain('Ep & 1')
    expect(text).toContain('Gone')
    expect(text).toContain('3 new episodes')
    expect(html).toContain('&lt;Show&gt;')
    expect(html).not.toContain('<Show>')
    expect(html).toContain('href="https://pods.example/e"')
    expect(html).toContain(`href="${origin}/settings/notifications"`)
  })
})

describe('liveEmail', () => {
  it('says who is live and links to the live page', async () => {
    const message = liveEmail('The Show', 'Q&A night', `${origin}/live/the-show`, `${origin}/settings/notifications`)
    expect(message.subject).toBe('The Show is live now')
    const { text } = await renderEmail(message, origin)
    expect(text).toContain('Q&A night')
    expect(text).toContain(`${origin}/live/the-show`)
    expect(text).toContain(`${origin}/settings/notifications`)
  })
})
