import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { checkMyChannelNow, setMyChannelEnabled } from '~/functions/channels'
import { formatDateTime, hostname } from '~/lib/format'
import { channelProviders } from '~/lib/platforms'

type Channel = {
  platform: string
  url: string
  title: string | null
  enabled: boolean
  lastCheckedAt: Date | null
  nextCheckAt: Date
  lastError: string | null
  checking: boolean
}

// The channel a podcast follows: when it was checked, and controls to pause
// checking or check now.
export function ChannelPanel({ podcastId, channel }: { podcastId: string; channel: Channel }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string>()
  const checking = channel.checking || !channel.lastCheckedAt
  const platform = channelProviders.find((p) => p.platform === channel.platform)?.label ?? hostname(channel.url)

  // A check can take a while behind other downloads, and may add nothing, so
  // there's no episode event to wait for: look again now and then until it's done.
  useEffect(() => {
    if (!checking) return
    const timer = setInterval(() => void router.invalidate(), 10_000)
    return () => clearInterval(timer)
  }, [checking, router])

  async function act(action: () => Promise<unknown>) {
    setPending(true)
    setMessage(undefined)
    try {
      await action()
      await router.invalidate()
    } catch {
      setMessage('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <Icons.broadcast className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            Following{' '}
            <a href={channel.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              {channel.title ?? channel.url}
            </a>{' '}
            on {platform}
          </span>
        </p>
        <p className="text-muted-foreground">
          {checking ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-3" />
              Looking for new uploads…
            </span>
          ) : (
            <>
              Last checked {formatDateTime(channel.lastCheckedAt!)}
              {channel.enabled ? ` · next check around ${formatDateTime(channel.nextCheckAt)}` : ' · paused'}
            </>
          )}
        </p>
        {channel.lastError && !checking && <p className="text-destructive">Couldn't check the channel: {channel.lastError}</p>}
        {message && <p className="text-destructive">{message}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <label className="flex items-center gap-2">
          <Switch
            checked={channel.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => act(() => setMyChannelEnabled({ data: { podcastId, enabled } }))}
          />
          Check for new uploads
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || checking}
          onClick={() =>
            act(async () => {
              const result = await checkMyChannelNow({ data: { podcastId } })
              if (result === 'too-soon') setMessage('It was checked a few minutes ago. Try again later.')
            })
          }
        >
          <Icons.retry />
          Check now
        </Button>
      </div>
    </section>
  )
}
