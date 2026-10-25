import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { RichTextEditor } from '~/components/rich-text-editor'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { saveSiteBranding } from '~/functions/branding'
import { brandLogoUrl, defaultLandingCopy, useBranding, type CopyItem, type LandingCopy } from '~/lib/branding'
import { brandingSchema, formatAnalyticsAttributes, parseAnalyticsAttributes } from '~/lib/branding-schema'
import { isAbort, uploadFile } from '~/lib/upload'

// The site's name, logo, landing page, legal pages and analytics, on the admin
// page (see src/lib/branding.ts). The logo is saved as soon as it's chosen;
// everything else with the Save button.
export function BrandingSettings() {
  const branding = useBranding()
  const router = useRouter()
  const [landing, setLanding] = useState<LandingCopy>(branding.landing)
  // Bumped to remount the editors, which only read their value when mounted.
  const [legalKey, setLegalKey] = useState(0)
  const privacy = useRef(branding.privacyHtml ?? '')
  const terms = useRef(branding.termsHtml ?? '')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    let analyticsAttributes: Record<string, string>
    try {
      analyticsAttributes = parseAnalyticsAttributes(values.analyticsAttributes ?? '')
    } catch (attributesError) {
      setError(attributesError instanceof Error ? attributesError.message : String(attributesError))
      return
    }
    const parsed = brandingSchema.safeParse({
      name: values.name,
      tagline: values.tagline,
      description: values.description,
      contactEmail: values.contactEmail,
      landing,
      privacyHtml: privacy.current || null,
      termsHtml: terms.current || null,
      analyticsScriptUrl: values.analyticsScriptUrl || null,
      analyticsAttributes,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the settings')
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await saveSiteBranding({ data: parsed.data })
      await router.invalidate()
      setSaved(true)
    } catch {
      setError('Something went wrong saving the branding. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const changed = () => setSaved(false)

  return (
    <form onSubmit={onSubmit} onChange={changed} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>What the site is called everywhere: pages, emails, feeds and link previews.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <LogoField />
            <div className="grid gap-6 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="branding-name">Name</FieldLabel>
                <Input id="branding-name" name="name" defaultValue={branding.name} required maxLength={40} />
              </Field>
              <Field>
                <FieldLabel htmlFor="branding-tagline">Tagline</FieldLabel>
                <Input id="branding-tagline" name="tagline" defaultValue={branding.tagline} required maxLength={80} />
                <FieldDescription>Shown with the name in emails and on the home page.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="branding-description">Description</FieldLabel>
              <Textarea id="branding-description" name="description" defaultValue={branding.description} required maxLength={300} />
              <FieldDescription>What the site does, in a sentence, for search results and link previews.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="branding-contact">Contact email</FieldLabel>
              <Input
                id="branding-contact"
                name="contactEmail"
                type="email"
                defaultValue={branding.contactEmail}
                required
                className="max-w-sm"
              />
              <FieldDescription>Where the privacy policy and terms tell people to write.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home page</CardTitle>
          <CardDescription>
            What signed-out visitors read. <code>{'{name}'}</code> becomes the site's name, and <code>*words*</code> in
            the headline are highlighted.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLanding(defaultLandingCopy)
                changed()
              }}
            >
              Reset to default
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <LandingFields copy={landing} onChange={setLanding} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy policy and terms</CardTitle>
          <CardDescription>
            Leave one empty to use the built-in text, which names the site and its contact email.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                privacy.current = ''
                terms.current = ''
                setLegalKey((key) => key + 1)
                changed()
              }}
            >
              Use built-in text
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup key={legalKey}>
            <Field>
              <FieldLabel htmlFor="branding-privacy">Privacy policy</FieldLabel>
              <RichTextEditor
                id="branding-privacy"
                headings
                value={privacy.current}
                placeholder="The built-in privacy policy"
                onChange={(html) => {
                  privacy.current = html
                  changed()
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="branding-terms">Terms of service</FieldLabel>
              <RichTextEditor
                id="branding-terms"
                headings
                value={terms.current}
                placeholder="The built-in terms of service"
                onChange={(html) => {
                  terms.current = html
                  changed()
                }}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analytics</CardTitle>
          <CardDescription>
            A script added to every page, such as Umami's, Plausible's or GoatCounter's tracking script.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="branding-analytics-url">Script address</FieldLabel>
              <Input
                id="branding-analytics-url"
                name="analyticsScriptUrl"
                type="url"
                defaultValue={branding.analytics?.src ?? ''}
                placeholder="https://analytics.example.com/script.js"
              />
              <FieldDescription>Blank for no analytics.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="branding-analytics-attributes">Script attributes</FieldLabel>
              <Textarea
                id="branding-analytics-attributes"
                name="analyticsAttributes"
                defaultValue={formatAnalyticsAttributes(branding.analytics?.attributes ?? {})}
                placeholder="data-website-id=…"
                className="font-mono"
              />
              <FieldDescription>One per line, as name=value: data-… attributes, async or defer.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save branding
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>
    </form>
  )
}

// The logo, replaced as soon as a new one is chosen.
function LogoField() {
  const branding = useBranding()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function run(action: () => Promise<unknown>) {
    setError(undefined)
    setPending(true)
    try {
      await action()
      await router.invalidate()
    } catch (logoError) {
      if (isAbort(logoError)) return
      setError(logoError instanceof Error ? logoError.message : 'Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Field>
      <FieldLabel>Logo</FieldLabel>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-20 place-items-center rounded-lg border bg-muted">
          {pending ? <Spinner /> : <img src={brandLogoUrl(branding)} alt="" className="size-16 object-contain" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            Upload a logo
          </Button>
          {branding.logoVersion && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const response = await fetch('/api/branding/logo', { method: 'DELETE' })
                  if (!response.ok) throw new Error((await response.text()) || 'Something went wrong. Please try again.')
                })
              }
            >
              Use the default
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void run(() => uploadFile('/api/branding/logo', file).done)
          }}
        />
      </div>
      {error && <FieldError>{error}</FieldError>}
      <FieldDescription>
        A square image, at least 512 pixels across, ideally with a transparent background. It's used for the favicon,
        home screen icons, emails and link previews, and is saved straight away.
      </FieldDescription>
    </Field>
  )
}

function LandingFields({ copy, onChange }: { copy: LandingCopy; onChange: (copy: LandingCopy) => void }) {
  const text = (key: Exclude<keyof LandingCopy, 'steps' | 'features'>, label: string, long = false) => (
    <Field>
      <FieldLabel htmlFor={`landing-${key}`}>{label}</FieldLabel>
      {long ? (
        <Textarea id={`landing-${key}`} value={copy[key]} onChange={(event) => onChange({ ...copy, [key]: event.target.value })} />
      ) : (
        <Input id={`landing-${key}`} value={copy[key]} onChange={(event) => onChange({ ...copy, [key]: event.target.value })} />
      )}
    </Field>
  )
  const items = (key: 'steps' | 'features', label: string) =>
    copy[key].map((item, index) => (
      <CopyItemFields
        key={index}
        id={`landing-${key}-${index}`}
        label={`${label} ${index + 1}`}
        item={item}
        onChange={(changed) => onChange({ ...copy, [key]: copy[key].map((old, i) => (i === index ? changed : old)) })}
      />
    ))

  return (
    <FieldGroup>
      <Section title="Introduction">
        {text('heroTitle', 'Headline')}
        {text('heroText', 'Introduction', true)}
      </Section>
      <Section title="How it works">
        {text('stepsTitle', 'Heading')}
        <div className="grid gap-4 md:grid-cols-3">{items('steps', 'Step')}</div>
      </Section>
      <Section title="Features">
        {text('featuresTitle', 'Heading')}
        {text('featuresText', 'Introduction', true)}
        <div className="grid gap-4 md:grid-cols-2">{items('features', 'Feature')}</div>
      </Section>
      <Section title="Podcasts">
        {text('exploreTitle', 'Heading')}
        {text('exploreText', 'Introduction')}
      </Section>
      <Section title="Closing">
        {text('ctaTitle', 'Heading')}
        {text('ctaText', 'Text')}
      </Section>
    </FieldGroup>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function CopyItemFields({
  id,
  label,
  item,
  onChange,
}: {
  id: string
  label: string
  item: CopyItem
  onChange: (item: CopyItem) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <FieldLabel htmlFor={`${id}-title`}>{label}</FieldLabel>
      <Input id={`${id}-title`} value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} />
      <Textarea
        aria-label={`${label} description`}
        value={item.description}
        onChange={(event) => onChange({ ...item, description: event.target.value })}
      />
    </div>
  )
}
