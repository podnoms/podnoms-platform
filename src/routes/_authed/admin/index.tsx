import { useState, type FormEvent } from 'react'
import { createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { Icons } from '~/components/icons'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import {
  endPlatformCooldown,
  fetchAdminOverview,
  saveAdminEmailSettings,
  saveAdminSettings,
  saveUserChannelLimit,
  sendAdminTestEmail,
} from '~/functions/admin'
import { formatDateTime } from '~/lib/format'
import type { Platform } from '~/lib/platforms'
import { emailSettingsSchema, siteSettingsSchema } from '~/lib/site-settings-schema'

export const Route = createFileRoute('/_authed/admin/')({
  beforeLoad: ({ context }) => {
    if (!context.session?.user?.isAdmin) throw notFound()
  },
  // The tab is in the URL, so it survives a reload and can be linked to.
  validateSearch: z.object({ tab: z.enum(['downloads', 'users', 'email']).optional().catch(undefined) }),
  loader: () => fetchAdminOverview(),
  head: () => ({ meta: [{ title: 'Admin · podnoms' }] }),
  component: AdminPage,
})

function AdminPage() {
  const overview = Route.useLoaderData()
  const { tab = 'downloads' } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-4 md:p-6">
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
      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({ search: { tab: value === 'downloads' ? undefined : (value as 'users' | 'email') }, replace: true })
        }
      >
        <TabsList variant="line">
          <TabsTrigger value="downloads">Downloads</TabsTrigger>
          <TabsTrigger value="users">
            Users
            <span className="text-muted-foreground tabular-nums">{overview.users.length}</span>
          </TabsTrigger>
          <TabsTrigger value="email">
            Email
            {!overview.email.enabled && <span className="size-1.5 rounded-full bg-muted-foreground" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="downloads" className="flex flex-col gap-6 pt-4">
          {!overview.jobsRunning && (
            <Alert>
              <AlertTitle>Channels aren't being checked</AlertTitle>
              <AlertDescription>
                REDIS_URL is not set, so the job queue isn't running. Podcasts made from a channel get its uploads when
                they're created, but not new ones.
              </AlertDescription>
            </Alert>
          )}
          <DownloadSummary throttle={overview.throttle} settings={overview.settings} />
          <DownloadQueue throttle={overview.throttle} />
          <DownloadSettings settings={overview.settings} />
        </TabsContent>
        <TabsContent value="users" className="flex flex-col gap-6 pt-4">
          <Users users={overview.users} />
        </TabsContent>
        <TabsContent value="email" className="flex flex-col gap-6 pt-4">
          <EmailSettings email={overview.email} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type Overview = Awaited<ReturnType<typeof fetchAdminOverview>>

// At a glance: how busy the download slots are, and whether any platform has
// paused us.
function DownloadSummary({ throttle, settings }: { throttle: Overview['throttle']; settings: Overview['settings'] }) {
  const stats = [
    {
      label: 'Downloading now',
      value: `${throttle.running.length} of ${settings.downloadConcurrency}`,
      detail: 'slots in use',
    },
    {
      label: 'Waiting',
      value: String(throttle.waiting.length),
      detail: throttle.waiting.length === 1 ? 'download waiting for a slot' : 'downloads waiting for a slot',
    },
    {
      label: 'Paused platforms',
      value: String(throttle.cooldowns.length),
      detail: throttle.cooldowns.length ? throttle.cooldowns.map((cooldown) => cooldown.platform).join(', ') : 'none',
    },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <Card key={stat.label} className="gap-1 py-4">
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{stat.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{stat.value}</span>
            <span className="text-xs text-muted-foreground">{stat.detail}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// What's downloading from the platforms now and what's waiting for a slot.
// Episode downloads and channel checks queue here; uploads don't.
function DownloadQueue({ throttle }: { throttle: Overview['throttle'] }) {
  const router = useRouter()
  const empty = throttle.running.length + throttle.waiting.length === 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Queue</CardTitle>
        <CardDescription>
          Episode downloads and channel checks wait here for a free slot, so the site never hits YouTube, Mixcloud and
          the rest too hard. Uploads don't queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        {empty ? (
          <Empty className="border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icons.download />
              </EmptyMedia>
              <EmptyTitle>The queue is empty</EmptyTitle>
              <EmptyDescription>Downloads show here while they run or wait for a slot.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {throttle.running.map((job, index) => (
                <TableRow key={`running-${index}`}>
                  <TableCell>
                    <Badge>Downloading</Badge>
                  </TableCell>
                  <TableCell className="capitalize">{job.platform}</TableCell>
                  <TableCell className="max-w-md truncate">{job.label}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(job.startedAt)}</TableCell>
                </TableRow>
              ))}
              {throttle.waiting.map((job, index) => (
                <TableRow key={`waiting-${index}`}>
                  <TableCell>
                    <Badge variant="secondary">Waiting</Badge>
                  </TableCell>
                  <TableCell className="capitalize">{job.platform}</TableCell>
                  <TableCell className="max-w-md truncate">{job.label}</TableCell>
                  <TableCell className="text-muted-foreground">Not yet</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// The SMTP server email is sent through. Set by environment variables, it's
// shown but can't be changed here; it can still be tested.
function EmailSettings({ email }: { email: Overview['email'] }) {
  const router = useRouter()
  const { session } = Route.useRouteContext()
  const locked = email.source === 'env'
  const [secure, setSecure] = useState(email.secure)
  const [clearPassword, setClearPassword] = useState(false)
  const [testTo, setTestTo] = useState(session?.user?.email ?? '')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  // The form's settings as entered, validated; null (with the error shown) if invalid.
  function settingsFrom(form: HTMLFormElement) {
    const values = Object.fromEntries(new FormData(form))
    const parsed = emailSettingsSchema.safeParse({ ...values, smtpSecure: secure, clearPassword })
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? 'Check the settings' })
      return null
    }
    return parsed.data
  }

  async function run(action: () => Promise<{ ok: boolean; text: string }>) {
    setMessage(undefined)
    setPending(true)
    try {
      setMessage(await action())
    } catch {
      setMessage({ ok: false, text: 'Something went wrong. Please try again.' })
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const settings = settingsFrom(event.currentTarget)
    if (!settings) return
    void run(async () => {
      await saveAdminEmailSettings({ data: settings })
      await router.invalidate()
      setClearPassword(false)
      return { ok: true, text: settings.smtpHost ? 'Saved' : 'Saved. Email is off.' }
    })
  }

  function sendTest(form: HTMLFormElement | null) {
    const settings = locked || !form ? undefined : settingsFrom(form)
    if (settings === null) return
    void run(async () => {
      const result = await sendAdminTestEmail({ data: { to: testTo, settings } })
      return result.ok ? { ok: true, text: `Sent to ${testTo}. Check the inbox (and spam folder).` } : { ok: false, text: result.error }
    })
  }

  return (
    <>
      <Alert>
        <AlertTitle>Your mail server must be allowed to send for your From address</AlertTitle>
        <AlertDescription>
          <p>
            Whichever SMTP server you use has to be set up to send email for the domain in the From address. Usually
            that means verifying the domain with your email provider and adding the SPF, DKIM (and ideally DMARC) DNS
            records it gives you.
          </p>
          <p>
            You do this with your email provider and DNS host; podnoms can't do it for you. Until it's done, emails may
            be refused or go to spam, even when the test email seems to send.
          </p>
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>SMTP server</CardTitle>
          <CardDescription>
            {locked
              ? 'The SMTP_* environment variables set the server, so it can only be changed there. You can still send a test below.'
              : 'The server password resets and notifications are sent through. Leave the host empty to turn email off.'}
          </CardDescription>
          <CardAction>
            <Badge variant={email.enabled ? 'default' : 'secondary'}>
              {locked ? 'Set by environment' : email.enabled ? 'On' : 'Off'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form id="email-settings" onSubmit={onSubmit} onChange={() => setMessage(undefined)}>
            <FieldGroup>
              <fieldset disabled={locked} className="grid gap-6 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="email-host">SMTP host</FieldLabel>
                  <Input id="email-host" name="smtpHost" defaultValue={email.host} placeholder="smtp.example.com" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-port">Port</FieldLabel>
                  <Input id="email-port" name="smtpPort" type="number" min={1} max={65535} defaultValue={String(email.port)} className="max-w-32" required />
                  <FieldDescription>Usually 587, or 465 with TLS from the start.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-user">Username</FieldLabel>
                  <Input id="email-user" name="smtpUser" defaultValue={email.user} autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-password">Password</FieldLabel>
                  <Input
                    id="email-password"
                    name="smtpPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder={email.hasPassword ? 'Saved (leave empty to keep it)' : ''}
                    disabled={clearPassword}
                  />
                  {email.hasPassword && !locked && (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={clearPassword} onChange={(event) => setClearPassword(event.target.checked)} />
                      Remove the saved password
                    </label>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="email-from">From</FieldLabel>
                  <Input id="email-from" name="emailFrom" defaultValue={email.from} placeholder="podnoms <hello@example.com>" />
                  <FieldDescription>Must be on a domain your mail server is allowed to send for.</FieldDescription>
                </Field>
                <Field orientation="horizontal" className="self-end">
                  <Switch id="email-secure" checked={secure} onCheckedChange={setSecure} />
                  <FieldLabel htmlFor="email-secure" className="font-normal">
                    TLS from the start (port 465)
                  </FieldLabel>
                </Field>
              </fieldset>
              {!locked && (
                <div>
                  <Button type="submit" disabled={pending}>
                    Save email settings
                  </Button>
                </div>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
          <CardDescription>
            Uses the settings above as they are now, saved or not, so you can check them before saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-72">
              <FieldLabel htmlFor="email-test-to">Send to</FieldLabel>
              <Input id="email-test-to" type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} />
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !testTo}
              onClick={() => sendTest(document.getElementById('email-settings') as HTMLFormElement | null)}
            >
              Send test email
            </Button>
          </div>
          {message &&
            (message.ok ? (
              <span className="text-sm text-muted-foreground">{message.text}</span>
            ) : (
              <FieldError>{message.text}</FieldError>
            ))}
        </CardContent>
      </Card>
    </>
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
    <Card>
      <CardHeader>
        <CardTitle>Limits</CardTitle>
        <CardDescription>
          These apply to everyone's downloads together, so the site stays a well-behaved visitor to YouTube, Mixcloud
          and the rest.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}

function Users({ users }: { users: Overview['users'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Uploads per channel is how many of a channel's newest uploads each user's podcasts import, and look at on each
          check. 0 stops them following channels.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
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
