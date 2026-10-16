import { useState, type FormEvent } from 'react'
import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { createMyTrackedLink, deleteMyTrackedLink } from '~/functions/tracked-links'
import { formatRelative, pluralise } from '~/lib/format'
import { trackedLinkLabelMaxLength } from '~/lib/tracked-link-schema'

export type TrackedLinkRow = {
  id: string
  label: string
  url: string
  openCount: number
  firstOpenedAt: Date | null
  lastOpenedAt: Date | null
  playCount: number
  lastPlayedAt: Date | null
  createdAt: Date
}

// An episode's tracked links: a share link for each person it's sent to, to
// see whether they opened it and pressed play (see tracked-links.server.ts).
export function TrackedLinksCard({
  episodeId,
  links,
  onChange,
}: {
  episodeId: string
  links: TrackedLinkRow[]
  // After a link is made or deleted, to reload them.
  onChange: () => Promise<void>
}) {
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!label.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createMyTrackedLink({ data: { episodeId, label } })
      setLabel('')
      await onChange()
    } catch {
      setError("Couldn't make the link. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    await deleteMyTrackedLink({ data: { id } })
    await onChange()
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Tracked links</h2>
        <p className="text-sm text-muted-foreground">
          Make a link for each person you send this episode to, and see here whether they opened it. Opening it
          yourself while signed in doesn't count.
        </p>
      </div>
      <form onSubmit={submit} className="flex max-w-xl gap-2">
        <Input
          aria-label="Who the link is for"
          placeholder="Who it's for, e.g. Alex"
          maxLength={trackedLinkLabelMaxLength}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" disabled={saving || !label.trim()}>
          <Icons.link />
          Make link
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {links.length > 0 && (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate font-medium">{link.label}</span>
                {link.playCount > 0 ? (
                  <Badge>Played</Badge>
                ) : link.openCount > 0 ? (
                  <Badge variant="secondary">Opened</Badge>
                ) : (
                  <Badge variant="outline">Not opened</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => remove(link.id)}
                  title="Delete link"
                >
                  <Icons.delete />
                  <span className="sr-only">Delete link</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                {describe(link)}
              </p>
              <CopyField label={`Link for ${link.label}`} value={link.url} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function describe(link: TrackedLinkRow) {
  if (!link.firstOpenedAt || !link.lastOpenedAt) return `Made ${formatRelative(link.createdAt)}, not opened yet`
  const parts = [
    link.openCount > 1
      ? `Opened ${pluralise(link.openCount, 'time')}, first ${formatRelative(link.firstOpenedAt)}, last ${formatRelative(link.lastOpenedAt)}`
      : `Opened ${formatRelative(link.firstOpenedAt)}`,
  ]
  if (link.lastPlayedAt) {
    parts.push(
      link.playCount > 1
        ? `played ${pluralise(link.playCount, 'time')}, last ${formatRelative(link.lastPlayedAt)}`
        : `played ${formatRelative(link.lastPlayedAt)}`,
    )
  }
  return parts.join(' · ')
}
