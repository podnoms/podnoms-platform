import { useState, type FormEvent } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { endPlatformCooldown, fetchAdminOverview, saveAdminSettings, saveUserChannelLimit } from '~/functions/admin'
import { formatDateTime } from '~/lib/format'
import type { Platform } from '~/lib/platforms'
import { siteSettingsSchema } from '~/lib/site-settings-schema'

export const Route = createFileRoute('/_authed/admin/')({
  beforeLoad: ({ context }) => {
    if (!context.session?.user?.isAdmin) throw notFound()
  },
  loader: () => fetchAdminOverview(),
  head: () => ({ meta: [{ title: 'Admin · podnoms' }] }),
  component: AdminPage,
})

function AdminPage() {
  const overview = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="flex max-w-4xl flex-col gap-8 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => router.invalidate()}>
          <Icons.retry />
          Refresh
        </Button>
        <Button variant="outline" size="sm" asChild>
          {/* The job queue UI is a separate page, not one of the app's routes. */}
          <a href="/admin/queues">
            <Icons.jobs />
            Jobs
          </a>
        </Button>
      </div>
      {!overview.jobsRunning && (
        <Alert>
          <AlertTitle>Channels aren't being checked</AlertTitle>
          <AlertDescription>
            REDIS_URL is not set, so the job queue isn't running. Podcasts made from a channel get its uploads when
            they're created, but not new ones.
          </AlertDescription>
        </Alert>
      )}
      <DownloadQueue throttle={overview.throttle} />
      <DownloadSettings settings={overview.settings} />
      <Users users={overview.users} />
    </div>
  )
}

type Overview = Awaited<ReturnType<typeof fetchAdminOverview>>

function DownloadQueue({ throttle }: { throttle: Overview['throttle'] }) {
  const router = useRouter()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Downloads</h2>
      {throttle.cooldowns.map(({ platform, until }) => (
        <Alert key={platform} variant="destructive">
          <AlertTitle>Paused downloads from {platform}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            It refused a request, so nothing more is sent to it until {formatDateTime(until)}.
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await endPlatformCooldown({ data: { platform: platform as Platform } })
                await router.invalidate()
              }}
            >
              Resume now
            </Button>
          </AlertDescription>
        </Alert>
      ))}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>State</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>What</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {throttle.running.length + throttle.waiting.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                Nothing is downloading.
              </TableCell>
            </TableRow>
          )}
          {throttle.running.map((job, index) => (
            <TableRow key={`running-${index}`}>
              <TableCell>Since {formatDateTime(job.startedAt)}</TableCell>
              <TableCell>{job.platform}</TableCell>
              <TableCell className="max-w-md truncate">{job.label}</TableCell>
            </TableRow>
          ))}
          {throttle.waiting.map((job, index) => (
            <TableRow key={`waiting-${index}`}>
              <TableCell className="text-muted-foreground">Waiting</TableCell>
              <TableCell>{job.platform}</TableCell>
              <TableCell className="max-w-md truncate">{job.label}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function DownloadSettings({ settings }: { settings: Overview['settings'] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = siteSettingsSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await saveAdminSettings({ data: parsed.data })
      await router.invalidate()
      setSaved(true)
    } catch {
      setError('Something went wrong saving the settings. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const number = (name: keyof Overview['settings'], label: string, description: string, min: number, max: number) => (
    <Field>
      <FieldLabel htmlFor={`setting-${name}`}>{label}</FieldLabel>
      <Input
        id={`setting-${name}`}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={String(settings[name])}
        required
        className="max-w-32"
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Download settings</h2>
      <p className="text-sm text-muted-foreground">
        These apply to everyone's downloads together, so the site stays a well-behaved visitor to YouTube, Mixcloud and
        the rest.
      </p>
      <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
        <FieldGroup>
          <div className="grid gap-6 sm:grid-cols-2">
            {number('downloadConcurrency', 'Downloads at once', 'From all platforms together.', 1, 10)}
            {number('perPlatformConcurrency', 'Downloads at once per platform', 'From any one platform.', 1, 10)}
            {number(
              'downloadDelaySeconds',
              'Seconds between requests',
              'The least time between starting two requests to the same platform, give or take 20%.',
              0,
              600,
            )}
            {number('channelCheckHours', 'Hours between channel checks', 'How often each channel is checked for new uploads.', 1, 168)}
            <Field>
              <FieldLabel htmlFor="setting-downloadRateLimit">Download speed limit</FieldLabel>
              <Input
                id="setting-downloadRateLimit"
                name="downloadRateLimit"
                defaultValue={settings.downloadRateLimit ?? ''}
                placeholder="Unlimited"
                className="max-w-32"
              />
              <FieldDescription>Bytes a second for each download, like 500K or 2M. Blank for no limit.</FieldDescription>
            </Field>
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              Save settings
            </Button>
            {saved && <span className="text-sm text-muted-foreground">Saved</span>}
          </div>
        </FieldGroup>
      </form>
    </section>
  )
}

function Users({ users }: { users: Overview['users'] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Users</h2>
      <p className="text-sm text-muted-foreground">
        How many of a channel's newest uploads each user's podcasts import, and look at on each check. 0 stops them
        following channels.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="text-end">Channels</TableHead>
            <TableHead>Uploads per channel</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span>{user.name ?? user.email}</span>
                  {user.name && <span className="text-xs text-muted-foreground">{user.email}</span>}
                </div>
              </TableCell>
              <TableCell className="text-end tabular-nums">{user.channels}</TableCell>
              <TableCell>
                <ChannelLimit userId={user.id} limit={user.channelEpisodeLimit} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function ChannelLimit({ userId, limit }: { userId: string; limit: number }) {
  const router = useRouter()
  const [value, setValue] = useState(String(limit))
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const changed = value !== String(limit)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('saving')
    try {
      await saveUserChannelLimit({ data: { userId, limit: Number(value) } })
      await router.invalidate()
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2">
      <Input
        aria-label="Uploads per channel"
        type="number"
        min={0}
        max={50}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setState('idle')
        }}
        className="h-8 w-20"
      />
      {changed && (
        <Button type="submit" size="sm" variant="outline" disabled={state === 'saving'}>
          Save
        </Button>
      )}
      {state === 'saved' && !changed && <Icons.check className="size-4 text-muted-foreground" />}
      {state === 'error' && <span className="text-xs text-destructive">Couldn't save</span>}
    </form>
  )
}
