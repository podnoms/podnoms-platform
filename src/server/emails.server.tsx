// The emails podnoms sends. Each is a message (subject, inbox preview and
// content); renderEmail puts it in the site's layout (emails/layout.tsx) and
// makes the HTML and plain-text versions, so every email looks the same.
import '@tanstack/react-start/server-only'
import type { ReactNode } from 'react'
import { render } from '@react-email/components'
import { platformNames, type Platform } from '~/lib/platforms'
import {
  colors,
  EmailButton,
  EmailDivider,
  EmailHeading,
  EmailLayout,
  EmailLink,
  EmailText,
} from '~/server/emails/layout'
import { emailLogo, logoCid } from '~/server/emails/logo.server'

export type EmailMessage = {
  subject: string
  // The line inboxes show after the subject.
  preview: string
  content: ReactNode
  // Why the reader got this email, under the card.
  footer?: ReactNode
}

export async function renderEmail(message: EmailMessage, origin: string | null) {
  const email = (
    <EmailLayout origin={origin} preview={message.preview} footer={message.footer}>
      {message.content}
    </EmailLayout>
  )
  const [html, text, logo] = await Promise.all([
    render(email),
    // Leaves out what only makes sense in HTML (marked data-skip-in-text).
    render(email, { plainText: true }),
    emailLogo(),
  ])
  // The icon the layout shows, attached to the email itself.
  const attachments = [{ filename: 'logo.png', content: logo, cid: logoCid, contentDisposition: 'inline' as const }]
  return { html, text, attachments }
}

export function testEmail(): EmailMessage {
  return {
    subject: 'podnoms test email',
    preview: 'If you’re reading this, email is working.',
    content: (
      <>
        <EmailHeading>Email is working</EmailHeading>
        <EmailText>This is a test email from podnoms. If you’re reading it, your mail server is set up.</EmailText>
        <EmailText muted>
          If it landed in spam, check that your mail server is allowed to send for the From address’s domain
          (its SPF and DKIM records).
        </EmailText>
      </>
    ),
    footer: 'Sent from the podnoms admin page.',
  }
}

export function passwordResetEmail(link: string): EmailMessage {
  return {
    subject: 'Reset your podnoms password',
    preview: 'Choose a new password. The link works once, for an hour.',
    content: (
      <>
        <EmailHeading>Reset your password</EmailHeading>
        <EmailText>Someone (hopefully you) asked to reset the password for your podnoms account.</EmailText>
        <EmailButton href={link}>Choose a new password</EmailButton>
        <EmailText muted>
          Or paste this link into your browser: <EmailLink href={link}>{link}</EmailLink>
        </EmailText>
      </>
    ),
    footer: 'The link works once, for an hour. If you didn’t ask for it, ignore this email: your password stays as it is.',
  }
}

export type NotificationEvent =
  | { type: 'episodeFailed'; podcastTitle: string; episodeTitle: string; error: string | null; link: string | null }
  | { type: 'newEpisodes'; podcastTitle: string; count: number; link: string | null }
  // New episodes from a podcast the user follows (see follower-notifications.server.ts).
  | { type: 'followedEpisodes'; podcastTitle: string; titles: string[]; link: string | null }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function EventRow({ event }: { event: NotificationEvent }) {
  const failed = event.type === 'episodeFailed'
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: '12px' }}>
      <tbody>
        <tr>
          <td
            style={{
              borderLeft: `3px solid ${failed ? '#ef4444' : colors.accent}`,
              padding: '4px 0 4px 12px',
              fontSize: '15px',
              lineHeight: '22px',
              color: colors.text,
            }}
          >
            {event.type === 'episodeFailed' ? (
              <>
                <strong>{event.episodeTitle}</strong> in {event.podcastTitle} couldn’t be processed
                {event.error ? <div style={{ fontSize: '13px', color: colors.muted }}>{event.error}</div> : null}
              </>
            ) : event.type === 'newEpisodes' ? (
              <>
                <strong>{plural(event.count, 'new episode')}</strong> from {event.podcastTitle}’s channel
              </>
            ) : (
              <>
                {event.titles.length === 1 ? <strong>{event.titles[0]}</strong> : <strong>{plural(event.titles.length, 'new episode')}</strong>}{' '}
                from {event.podcastTitle}
                {event.titles.length > 1 && (
                  <div style={{ fontSize: '13px', color: colors.muted }}>{event.titles.join(' · ')}</div>
                )}
              </>
            )}
            {event.link && (
              <div style={{ fontSize: '13px' }}>
                <EmailLink href={event.link}>
                  {event.type === 'episodeFailed' ? 'Retry or upload it again' : event.type === 'newEpisodes' ? 'See them' : 'Listen'}
                </EmailLink>
              </div>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

// Everything that happened to the user's podcasts, and the ones they follow,
// in the last few minutes, in one email.
export function notificationDigestEmail(events: NotificationEvent[], settingsLink: string | null): EmailMessage {
  const failures = events.filter((event) => event.type === 'episodeFailed').length
  const added = events.reduce((sum, event) => sum + (event.type === 'newEpisodes' ? event.count : 0), 0)
  const followed = events.flatMap((event) => (event.type === 'followedEpisodes' ? [event] : []))
  // About the user's own podcasts if there's anything, as that's more pressing.
  const subject =
    failures && added
      ? `${plural(failures, 'episode')} failed, ${added} new`
      : failures
        ? `${failures === 1 ? 'An episode' : `${failures} episodes`} couldn’t be processed`
        : added
          ? `${plural(added, 'new episode')} on podnoms`
          : followed.length === 1 && followed[0]!.titles.length === 1
            ? `New from ${followed[0]!.podcastTitle}: ${followed[0]!.titles[0]}`
            : `${plural(followed.reduce((sum, event) => sum + event.titles.length, 0), 'new episode')} from podcasts you follow`
  const failed = events.filter((event) => event.type === 'episodeFailed')
  const news = events.filter((event) => event.type === 'newEpisodes')
  return {
    subject,
    preview: events.map((event) => event.podcastTitle).filter((title, i, all) => all.indexOf(title) === i).join(', '),
    content: (
      <>
        <EmailHeading>{subject}</EmailHeading>
        {failed.map((event, index) => (
          <EventRow key={`failed-${index}`} event={event} />
        ))}
        {failed.length > 0 && news.length > 0 && <EmailDivider />}
        {news.map((event, index) => (
          <EventRow key={`new-${index}`} event={event} />
        ))}
        {failed.length + news.length > 0 && followed.length > 0 && <EmailDivider />}
        {followed.map((event, index) => (
          <EventRow key={`followed-${index}`} event={event} />
        ))}
      </>
    ),
    footer: <NotificationFooter settingsLink={settingsLink} />,
  }
}

// To admins, when a platform starts asking us to prove we're not a bot (see
// admin-alerts.server.ts).
export function botCheckEmail(platform: Platform, error: string, adminLink: string | null): EmailMessage {
  const name = platformNames[platform]
  return {
    subject: `${name} is asking podnoms to prove it isn’t a bot`,
    preview: `Downloads from ${name} have stopped for everyone until yt-dlp has fresh cookies.`,
    content: (
      <>
        <EmailHeading>{name} wants podnoms to sign in</EmailHeading>
        <EmailText>
          {name} is refusing downloads with a “confirm you’re not a bot” check, so downloads from it are paused for every
          user. They’ll be tried again later, but will probably keep failing until it’s fixed.
        </EmailText>
        <EmailText>
          Usually the cookies in YTDLP_COOKIES_FILE have expired (or it isn’t set). Export fresh ones from a signed-in
          throwaway account (see{' '}
          <EmailLink href="https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies">
            exporting YouTube cookies
          </EmailLink>
          ), replace the file, then clear the pause on the admin page.
        </EmailText>
        {adminLink && <EmailButton href={adminLink}>Open the admin page</EmailButton>}
        <EmailText muted>{error}</EmailText>
      </>
    ),
    footer: 'You get this as a podnoms admin, at most every 6 hours while it keeps happening.',
  }
}

// Why the reader got a notification email, and where to change it.
function NotificationFooter({ settingsLink }: { settingsLink: string | null }) {
  return settingsLink ? (
    <>
      You get these emails about your podcasts and the ones you follow.{' '}
      <EmailLink href={settingsLink}>Choose which ones</EmailLink>.
    </>
  ) : (
    'You get these emails about your podcasts and the ones you follow. Choose which ones in your podnoms settings.'
  )
}

// To a follower, when a podcast they follow goes live: sent at once, rather
// than with the next digest.
export function liveEmail(
  podcastTitle: string,
  broadcastTitle: string,
  link: string | null,
  settingsLink: string | null,
): EmailMessage {
  return {
    subject: `${podcastTitle} is live now`,
    preview: broadcastTitle,
    content: (
      <>
        <EmailHeading>{podcastTitle} is live</EmailHeading>
        <EmailText>{broadcastTitle}</EmailText>
        {link && <EmailButton href={link}>Watch and chat</EmailButton>}
      </>
    ),
    footer: <NotificationFooter settingsLink={settingsLink} />,
  }
}
