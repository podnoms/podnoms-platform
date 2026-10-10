import { useState, type FormEvent } from 'react'
import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { saveCustomDomain, testCustomDomain } from '~/functions/podcasts'
import { domainFeedPath, txtRecordName, txtRecordValue } from '~/lib/custom-domain'
import { formatDate } from '~/lib/format'
import { customDomainSchema } from '~/lib/podcast-schema'

type Podcast = {
  id: string
  customDomain: string | null
  customDomainToken: string | null
  customDomainVerifiedAt: Date | null
  customDomainFailingSince: Date | null
}

type RecordCheck = { ok: true } | { ok: false; reason: string }
type TestResult = { cname: RecordCheck; txt: RecordCheck }

// How long a verified domain's records may stay broken (see custom-domains.server.ts).
const graceDays = 3

// Serving the podcast from the owner's own domain: the domain, the two DNS
// records to add for it, and a button that checks them.
export function CustomDomainCard({
  podcast,
  target,
  onChanged,
}: {
  podcast: Podcast
  // Where the CNAME points.
  target: string
  onChanged: () => Promise<void>
}) {
  const [pending, setPending] = useState<'save' | 'remove' | 'test'>()
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<TestResult>()
  const domain = podcast.customDomain
  const verified = Boolean(podcast.customDomainVerifiedAt)

  async function save(value: string) {
    const parsed = customDomainSchema.safeParse({ id: podcast.id, domain: value })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setResult(undefined)
    setPending(parsed.data.domain ? 'save' : 'remove')
    try {
      const saved = await saveCustomDomain({ data: parsed.data })
      if (saved.error) setError(saved.error)
      else await onChanged()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(undefined)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await save(String(new FormData(event.currentTarget).get('domain') ?? ''))
  }

  async function test() {
    setError(undefined)
    setPending('test')
    try {
      setResult(await testCustomDomain({ data: { id: podcast.id } }))
      await onChanged()
    } catch {
      setError('Something went wrong checking the domain. Please try again.')
    } finally {
      setPending(undefined)
    }
  }

  const failingSince = podcast.customDomainFailingSince
  const dropsOn = failingSince && new Date(failingSince.getTime() + graceDays * 24 * 60 * 60 * 1000)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Custom domain
          {domain && (
            <Badge variant={verified ? (failingSince ? 'destructive' : 'default') : 'secondary'}>
              {verified ? (failingSince ? 'DNS changed' : 'Verified') : 'Not verified'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Serve the podcast's page and feed from a domain of your own, such as pod.example.com.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="custom-domain">Domain</FieldLabel>
              <div className="flex gap-2">
                <Input
                  // Reset when the saved domain changes.
                  key={domain ?? ''}
                  id="custom-domain"
                  name="domain"
                  defaultValue={domain ?? ''}
                  placeholder="pod.example.com"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={300}
                />
                <Button type="submit" disabled={Boolean(pending)}>
                  Save
                </Button>
                {domain && (
                  <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={() => save('')}>
                    Remove
                  </Button>
                )}
              </div>
              <FieldDescription>
                Use a subdomain (pod.example.com rather than example.com): a CNAME can't be set on a domain's root.
              </FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>

        {domain && podcast.customDomainToken && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">DNS records</h3>
              <p className="text-sm text-muted-foreground">
                Add both at your domain's DNS provider, then test them. Changes can take a while to show up. If your
                provider proxies traffic (Cloudflare's orange cloud), turn that off for this record.
              </p>
            </div>
            <DnsRecord type="CNAME" name={domain} value={target} check={result?.cname} />
            <DnsRecord
              type="TXT"
              name={txtRecordName(domain)}
              value={txtRecordValue(podcast.customDomainToken)}
              check={result?.txt}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={Boolean(pending)} onClick={test}>
                <Icons.retry />
                {pending === 'test' ? 'Testing…' : 'Test DNS records'}
              </Button>
              {podcast.customDomainVerifiedAt && !failingSince && (
                <span className="text-sm text-muted-foreground">
                  Verified {formatDate(podcast.customDomainVerifiedAt)}
                </span>
              )}
              {dropsOn && (
                <span className="text-sm text-destructive">
                  The records stopped checking out; the domain stops working on {formatDate(dropsOn)} unless they're fixed.
                </span>
              )}
            </div>
          </div>
        )}

        {domain && verified && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">On your domain</h3>
              <p className="text-sm text-muted-foreground">
                The first visit can take a minute while its HTTPS certificate is issued. Your podnoms feed keeps working,
                so there's no need to move existing subscribers.
              </p>
            </div>
            <CopyField label="Podcast page" value={`https://${domain}/`}>
              <a
                href={`https://${domain}/`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-muted"
                title="Open"
              >
                <Icons.externalLink className="size-3.5" />
                <span className="sr-only">Open</span>
              </a>
            </CopyField>
            <CopyField label="RSS feed on your domain" value={`https://${domain}${domainFeedPath}`} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DnsRecord({ type, name, value, check }: { type: string; name: string; value: string; check?: RecordCheck }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className="font-mono">
          {type}
        </Badge>
        <span className="min-w-0 truncate font-mono">{name}</span>
        {check &&
          (check.ok ? (
            <Icons.check className="ml-auto size-4 shrink-0 text-green-600 dark:text-green-400" aria-label="Found" />
          ) : (
            <Icons.close className="ml-auto size-4 shrink-0 text-destructive" aria-label="Not right yet" />
          ))}
      </div>
      <CopyField label={`${type} record name`} value={name} />
      <CopyField label={`${type} record value`} value={value} />
      {check && !check.ok && <p className="text-sm text-destructive">{check.reason}</p>}
    </div>
  )
}
