// The frame every email is sent in (see renderEmail in emails.server.tsx): the
// site's icon (embedded, see logo.server.ts) and name, a white card for the message, and a footer. Built
// with React Email, which turns it into the table-based, inline-styled HTML
// email clients need, and a plain-text version.
import type { ReactNode } from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components'
import { siteName, siteTagline } from '~/lib/site'
import { logoCid, logoSize } from '~/server/emails/logo.server'

// The site's colours: its pink, on a soft grey page.
export const colors = {
  page: '#f4f4f5',
  card: '#ffffff',
  text: '#18181b',
  muted: '#71717a',
  border: '#e4e4e7',
  accent: '#f4a6c8',
  accentText: '#18181b',
} as const

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export function EmailLayout({
  origin,
  preview,
  footer,
  children,
}: {
  // Where the site is, for links; without it they're left out.
  origin: string | null
  // The line inboxes show after the subject.
  preview: string
  // Why the reader got this email, under the card.
  footer?: ReactNode
  children: ReactNode
}) {
  // The site icon, attached to the email (see logo.server.ts).
  const icon = (
    <Img
      src={`cid:${logoCid}`}
      width={String(logoSize)}
      height={String(logoSize)}
      alt={siteName}
      style={{ borderRadius: '8px', display: 'block' }}
    />
  )
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.page, fontFamily: font, margin: 0, padding: '32px 12px' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto' }}>
          <Section style={{ padding: '0 8px 20px' }}>
            <table role="presentation" cellPadding={0} cellSpacing={0}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: '10px', verticalAlign: 'middle' }} data-skip-in-text="true">
                    {origin ? <Link href={origin}>{icon}</Link> : icon}
                  </td>
                  <td style={{ verticalAlign: 'middle' }}>
                    <Text style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: colors.text, lineHeight: '24px' }}>
                      {siteName}
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>
          <Section
            style={{
              backgroundColor: colors.card,
              borderRadius: '16px',
              border: `1px solid ${colors.border}`,
              padding: '32px',
            }}
          >
            {children}
          </Section>
          <Section style={{ padding: '20px 8px 0' }}>
            {footer && <Text style={{ ...small, margin: '0 0 8px' }}>{footer}</Text>}
            <Text style={{ ...small, margin: 0 }}>
              {origin ? (
                <Link href={origin} style={{ color: colors.muted, textDecoration: 'underline' }}>
                  {siteName}
                </Link>
              ) : (
                siteName
              )}{' '}
              · {siteTagline}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const small = { fontSize: '12px', lineHeight: '18px', color: colors.muted } as const

// Building blocks for the messages that go in the layout.

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading as="h1" style={{ margin: '0 0 16px', fontSize: '22px', lineHeight: '28px', fontWeight: 700, color: colors.text }}>
      {children}
    </Heading>
  )
}

export function EmailText({ muted, children }: { muted?: boolean; children: ReactNode }) {
  return (
    <Text
      style={{ margin: '0 0 16px', fontSize: muted ? '13px' : '15px', lineHeight: muted ? '20px' : '24px', color: muted ? colors.muted : colors.text }}
    >
      {children}
    </Text>
  )
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: '8px 0 24px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: colors.accent,
          color: colors.accentText,
          borderRadius: '10px',
          padding: '12px 22px',
          fontSize: '15px',
          fontWeight: 600,
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        {children}
      </Button>
    </Section>
  )
}

export function EmailLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={{ color: colors.text, textDecoration: 'underline' }}>
      {children}
    </Link>
  )
}

export function EmailDivider() {
  return <Hr style={{ borderColor: colors.border, margin: '24px 0' }} />
}
