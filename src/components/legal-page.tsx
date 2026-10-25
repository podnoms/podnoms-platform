import type { ReactNode } from 'react'
import { useBranding } from '~/lib/branding'

// The layout shared by the privacy policy and terms of service. `html`, an
// admin's own text (see branding.server.ts, which sanitises it), replaces the
// built-in text in `children`.
export function LegalPage({
  title,
  updated,
  html,
  children,
}: {
  title: string
  updated: string
  html: string | null
  children: ReactNode
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {!html && <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>}
      </header>
      {html ? <div className="rich-text text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} /> : children}
    </main>
  )
}

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3 leading-relaxed [&_li]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

// Where people write about their data or these terms.
export function ContactLink() {
  const { contactEmail } = useBranding()
  return (
    <a href={`mailto:${contactEmail}`} className="underline underline-offset-4">
      {contactEmail}
    </a>
  )
}
