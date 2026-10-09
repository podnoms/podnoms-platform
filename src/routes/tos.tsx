import { Link, createFileRoute } from '@tanstack/react-router'
import { ContactLink, LegalPage, LegalSection } from '~/components/legal-page'

export const Route = createFileRoute('/tos')({
  head: () => ({
    meta: [{ title: 'Terms of service · podnoms' }, { name: 'description', content: 'The terms for using podnoms.' }],
  }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="9 October 2026">
      <p>
        These terms apply when you use podnoms. By creating an account or using the site you agree to them. If you
        don't agree, please don't use podnoms.
      </p>

      <LegalSection title="Your account">
        <p>
          You need to be at least 13 to use podnoms. Keep your sign-in details safe: you're responsible for what happens
          under your account. Tell us at <ContactLink /> if you think someone else has access to it.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You keep ownership of the podcasts, episodes and files you add. You give us permission to store, process and
          publish them as needed to run the service, for example by converting audio and serving it in your podcast's
          feed.
        </p>
        <p>
          You're responsible for what you add. Only use podnoms with content you have the right to use, which includes
          content you download from other sites through links. Respect the terms of those sites and the rights of the
          people who made it.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>Don't use podnoms to:</p>
        <ul>
          <li>infringe copyright or other rights, or share content you aren't allowed to share;</li>
          <li>publish anything illegal, hateful, harassing or sexually explicit involving minors;</li>
          <li>spread malware, spam or anything designed to deceive;</li>
          <li>overload, probe or break the service, or get around its limits.</li>
        </ul>
        <p>We may remove content or suspend accounts that break these rules.</p>
      </LegalSection>

      <LegalSection title="Copyright complaints">
        <p>
          If you believe content on podnoms infringes your copyright, email <ContactLink /> with the address of the
          content and details of your work. We'll look into it and remove infringing content.
        </p>
      </LegalSection>

      <LegalSection title="The service">
        <p>
          podnoms is provided as it is, without warranties of any kind. We do our best to keep it running and your data
          safe, but we can't promise the service will always be available or free of errors, and we may change, limit or
          stop features at any time. Keep your own copies of anything important.
        </p>
        <p>
          To the extent the law allows, we aren't liable for any indirect or consequential loss, or for loss of data,
          arising from your use of podnoms.
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using podnoms at any time and ask us to delete your account (see the{' '}
          <Link to="/privacy" hash="deletion" className="underline underline-offset-4">
            privacy policy
          </Link>
          ). We may close accounts that break these terms.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. When we make significant changes we'll update the date above, and continuing to
          use podnoms afterwards means you accept them.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms? Email <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
