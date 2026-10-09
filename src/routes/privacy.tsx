import { createFileRoute } from '@tanstack/react-router'
import { ContactLink, LegalPage, LegalSection } from '~/components/legal-page'
import { siteHead } from '~/lib/page-meta'
import { siteInfo } from '~/lib/site'

export const Route = createFileRoute('/privacy')({
  head: ({ matches }) => {
    const site = siteInfo(matches)
    return site?.origin
      ? siteHead({ origin: site.origin, path: '/privacy', title: 'Privacy policy · podnoms', description: 'How podnoms collects and uses your data.' })
      : { meta: [{ title: 'Privacy policy · podnoms' }] }
  },
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="9 October 2026">
      <p>
        This policy explains what podnoms collects when you use the site, why, and what you can do about it. If anything
        here is unclear, email <ContactLink />.
      </p>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> your email address and, if you give them, your name and profile picture. If
            you sign up with a password it is stored hashed, never in plain text. If you sign in with GitHub, Google or
            Facebook, we receive your name, email address and profile picture from that service.
          </li>
          <li>
            <strong>Two-factor authentication:</strong> if you turn it on, your authenticator secret (encrypted), the
            public keys of your security keys and hashed recovery codes.
          </li>
          <li>
            <strong>Your content:</strong> the podcasts and episodes you create, the links you submit, the files you
            upload and the audio and images we make from them.
          </li>
          <li>
            <strong>Listening activity:</strong> plays, downloads and shares of episodes, with the listener's country,
            region and city, app and referring site. Listeners are told apart by a hash of their IP address and browser,
            salted with a random value that changes daily and is then deleted. We don't keep IP addresses.
          </li>
          <li>
            <strong>Technical data:</strong> server logs and error reports, used to keep the site running and fix
            problems, and privacy-friendly, cookie-free visitor statistics.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <p>
          We use your data only to run podnoms: to sign you in, build and serve your podcasts and feeds, show you
          statistics about your listeners, keep the service secure and fix problems. We don't sell your data or use it for
          advertising.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          We use only the cookies needed for the site to work: one that keeps you signed in, and short-lived ones that
          protect sign-in from forgery. Your browser may also store preferences such as your theme and player volume.
        </p>
      </LegalSection>

      <LegalSection title="Who else sees your data">
        <ul>
          <li>Anyone with the link can see public podcasts, their episodes and their RSS feeds.</li>
          <li>The sign-in provider you choose (GitHub, Google or Facebook) knows that you signed in to podnoms.</li>
          <li>
            Services that help us run the site, such as our hosting and network providers, process data on our behalf.
          </li>
          <li>We will disclose data if the law requires it.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your account and content until you delete them or ask us to delete your account. Uploads that are
          never turned into episodes are removed after a day. Logs and error reports are kept only as long as they're
          useful for running the service.
        </p>
      </LegalSection>

      <LegalSection id="deletion" title="Deleting your data">
        <p>
          You can delete your podcasts and episodes at any time from the site. To delete your account and everything
          in it, including data received from a sign-in provider such as Facebook, email <ContactLink /> from the
          address on your account. We'll delete it within 30 days and confirm when it's done.
        </p>
        <p>
          You can also ask us for a copy of your data or to correct it. Depending on where you live, you may have other
          rights under laws such as the GDPR, including the right to complain to your data protection authority.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>podnoms is not meant for children under 13, and we don't knowingly collect their data.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update this policy. When we make significant changes we'll update the date above and, where
          appropriate, let you know.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
