// The desktop notifications card on the notification settings: turning them
// on or off in this browser, which kinds the user gets, the podcasts they
// follow (each of which can be muted), and the other browsers they're on in.
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from '~/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '~/components/ui/item'
import { Switch } from '~/components/ui/switch'
import { Icons } from '~/components/icons'
import type { fetchPushSettings } from '~/functions/push'
import { saveFollowNotify, savePushPrefs, subscribeToPush, unsubscribeFromPush } from '~/functions/push'
import { formatDate } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { currentPushSubscription, pushSupported, subscribeThisBrowser, unsubscribeThisBrowser } from '~/lib/push'

type Settings = Awaited<ReturnType<typeof fetchPushSettings>>
type Pref = 'pushLive' | 'pushNewEpisodes'

const kinds: { pref: Pref; label: string; description: string }[] = [
  { pref: 'pushLive', label: 'Going live', description: 'When a podcast you follow starts a live broadcast.' },
  { pref: 'pushNewEpisodes', label: 'New episodes', description: 'When a podcast you follow has a new episode.' },
]

// What this browser can do: worked out once it has loaded, as the server
// can't know.
type BrowserState = 'checking' | 'unsupported' | 'blocked' | 'on' | 'off'

export function DesktopNotifications({ settings, onChange }: { settings: Settings; onChange: () => Promise<void> }) {
  const [browser, setBrowser] = useState<BrowserState>('checking')
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!pushSupported()) return setBrowser('unsupported')
    if (Notification.permission === 'denied') return setBrowser('blocked')
    void currentPushSubscription().then((subscription) => {
      setEndpoint(subscription?.endpoint ?? null)
      // On here only if the server still has it (it may have been removed
      // from another browser).
      const known = subscription && settings.devices.some((device) => device.endpoint === subscription.endpoint)
      setBrowser(known ? 'on' : 'off')
    })
  }, [settings.devices])

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    try {
      await work()
      await onChange()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () =>
    run(async () => {
      const result = await subscribeThisBrowser(settings.publicKey)
      if ('error' in result) {
        if (result.error === 'denied') setBrowser('blocked')
        return
      }
      await subscribeToPush({ data: result.subscription })
    })

  const turnOff = () =>
    run(async () => {
      const gone = await unsubscribeThisBrowser()
      if (gone) await unsubscribeFromPush({ data: { endpoint: gone } })
    })

  const remove = (id: string, deviceEndpoint: string) =>
    run(async () => {
      if (deviceEndpoint === endpoint) await unsubscribeThisBrowser()
      await unsubscribeFromPush({ data: { id } })
    })

  const setPref = (pref: Pref, value: boolean) =>
    run(() => savePushPrefs({ data: { pushLive: settings.pushLive, pushNewEpisodes: settings.pushNewEpisodes, [pref]: value } }))

  const setNotify = (podcastId: string, notify: boolean) => run(() => saveFollowNotify({ data: { podcastId, notify } }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desktop notifications</CardTitle>
        <CardDescription>
          About the podcasts you follow, shown by your browser even when podnoms isn't open.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ThisBrowser state={browser} busy={busy} onTurnOn={turnOn} onTurnOff={turnOff} />

        <FieldGroup>
          {kinds.map(({ pref, label, description }) => (
            <Field key={pref} orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={pref}>{label}</FieldLabel>
                <FieldDescription>{description}</FieldDescription>
              </FieldContent>
              <Switch id={pref} checked={settings[pref]} disabled={busy} onCheckedChange={(value) => void setPref(pref, value)} />
            </Field>
          ))}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <FieldSeparator />

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium">Podcasts you follow</h3>
            <p className="text-sm text-muted-foreground">Turn one off to stop hearing about it, but keep following it.</p>
          </div>
          {settings.follows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don't follow any podcasts yet. <Link to="/explore" className="text-primary hover:underline">Explore podcasts</Link>{' '}
              to find some.
            </p>
          ) : (
            <ItemGroup className="gap-1">
              {settings.follows.map((podcast) => (
                <Item key={podcast.podcastId} size="sm" variant="outline">
                  <ItemMedia variant="image">
                    {podcast.imageUrl ? (
                      <img src={imageSrc(podcast.imageUrl, 80)} alt="" />
                    ) : (
                      <Icons.logo className="size-5 text-muted-foreground" />
                    )}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <Link to="/$slug" params={{ slug: podcast.slug }} className="hover:underline">
                        {podcast.title}
                      </Link>
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={`Notifications about ${podcast.title}`}
                      checked={podcast.notify}
                      disabled={busy}
                      onCheckedChange={(value) => void setNotify(podcast.podcastId, value)}
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </section>

        {settings.devices.length > 0 && (
          <>
            <FieldSeparator />
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Browsers they're on in</h3>
              <ItemGroup className="gap-1">
                {settings.devices.map((device) => (
                  <Item key={device.id} size="sm" variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {device.label}
                        {device.endpoint === endpoint && <span className="text-muted-foreground">(this browser)</span>}
                      </ItemTitle>
                      <ItemDescription>Since {formatDate(new Date(device.createdAt))}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(device.id, device.endpoint)}>
                        Turn off
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ThisBrowser({
  state,
  busy,
  onTurnOn,
  onTurnOff,
}: {
  state: BrowserState
  busy: boolean
  onTurnOn: () => void
  onTurnOff: () => void
}) {
  if (state === 'checking') return null
  if (state === 'unsupported') {
    return (
      <Alert>
        <AlertTitle>This browser can't show them</AlertTitle>
        <AlertDescription>
          Try another browser. On an iPhone or iPad, add podnoms to your Home Screen first, then turn them on from there.
        </AlertDescription>
      </Alert>
    )
  }
  if (state === 'blocked') {
    return (
      <Alert>
        <AlertTitle>Notifications are blocked for podnoms</AlertTitle>
        <AlertDescription>
          Allow them in your browser's site settings (usually the icon beside the address), then reload this page.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel>{state === 'on' ? 'On in this browser' : 'Off in this browser'}</FieldLabel>
        <FieldDescription>
          {state === 'on'
            ? "You'll get them here for the kinds and podcasts chosen below."
            : 'Your browser will ask whether podnoms may show notifications.'}
        </FieldDescription>
      </FieldContent>
      {state === 'on' ? (
        <Button variant="outline" disabled={busy} onClick={onTurnOff}>
          Turn off
        </Button>
      ) : (
        <Button disabled={busy} onClick={onTurnOn}>
          Turn on
        </Button>
      )}
    </Field>
  )
}
