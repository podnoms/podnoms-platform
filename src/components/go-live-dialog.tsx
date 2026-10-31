import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ButtonGroup } from '~/components/ui/button-group'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { createMyLiveKey, fetchMyLive, revokeMyLiveKey, saveMyLiveTitle } from '~/functions/live'
import { formatDateTime, formatLength } from '~/lib/format'
import { liveTitleMaxLength } from '~/lib/live-schema'

// How often the open dialog checks whether the show has gone live or stopped.
const refreshMs = 10_000

type Settings = Awaited<ReturnType<typeof fetchMyLive>>
type Show = { id: string; slug: string; title: string }

const liveButtonClass =
  'bg-destructive font-semibold text-destructive-foreground shadow-md shadow-destructive/30 hover:bg-destructive/90'

// The owner's way in to broadcasting: a button that stands out from the
// show's others, opening the settings for streaming from OBS. While it's
// live, it goes to the live page instead, with the settings a click beside it.
export function GoLiveButton({ show, live }: { show: Show; live: boolean }) {
  return (
    <Dialog>
      {live ? (
        <ButtonGroup>
          <Button className={liveButtonClass} asChild>
            <Link to="/live/$slug" params={{ slug: show.slug }}>
              <span className="size-2 animate-pulse rounded-full bg-destructive-foreground" />
              Live now
            </Link>
          </Button>
          <DialogTrigger asChild>
            <Button size="icon" className={liveButtonClass} title="Stream settings">
              <Icons.settings />
              <span className="sr-only">Stream settings</span>
            </Button>
          </DialogTrigger>
        </ButtonGroup>
      ) : (
        <DialogTrigger asChild>
          <Button className={liveButtonClass}>
            <Icons.broadcast />
            Go live
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <GoLiveSettings show={show} />
      </DialogContent>
    </Dialog>
  )
}

// Broadcasting live from OBS: the server and stream key to paste in, the
// next broadcast's title, what's on now, and past broadcasts with the draft
// episodes made from their recordings. Only mounted while the dialog is open,
// so it only loads (and refreshes) then.
function GoLiveSettings({ show }: { show: Show }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState<'reset' | 'revoke' | null>(null)
  const [error, setError] = useState<string>()

  const load = useCallback(
    () =>
      fetchMyLive({ data: { showId: show.id } }).then(
        (loaded) => {
          setSettings(loaded)
          return loaded
        },
        () => {
          setError("Couldn't load the live settings. Reload the page to try again.")
          return null
        },
      ),
    [show.id],
  )

  useEffect(() => {
    void load().then((loaded) => setTitle(loaded?.liveTitle ?? ''))
    const timer = setInterval(() => void load(), refreshMs)
    return () => clearInterval(timer)
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError(undefined)
    try {
      await action()
      await load()
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setPending(false)
      setConfirm(null)
    }
  }

  const makeKey = () => run(() => createMyLiveKey({ data: { showId: show.id } }))

  function saveTitle(event: FormEvent) {
    event.preventDefault()
    void run(() => saveMyLiveTitle({ data: { showId: show.id, title } }))
  }

  if (!settings) {
    return (
      <DialogHeader>
        <DialogTitle>Go live</DialogTitle>
        <DialogDescription>{error ?? 'Loading…'}</DialogDescription>
      </DialogHeader>
    )
  }

  const { live } = settings
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Go live
          {live ? (
            <Badge className="bg-destructive text-destructive-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-destructive-foreground" />
              Live
            </Badge>
          ) : (
            <Badge variant="secondary">Offline</Badge>
          )}
        </DialogTitle>
        <DialogDescription>
          Broadcast video from OBS to your show's live page, with a chat for your listeners. When you stop, the
          recording becomes a private episode for you to check and publish.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {live && (
          <p className="text-sm">
            <span className="font-medium">{live.title}</span>{' '}
            <span className="text-muted-foreground">since {formatDateTime(live.startedAt)}</span>
          </p>
        )}
        <Button variant="outline" className="w-fit" asChild>
          <Link to="/live/$slug" params={{ slug: show.slug }} target="_blank">
            <Icons.externalLink />
            Live page
          </Link>
        </Button>

        <Field>
          <FieldLabel>Stream from OBS</FieldLabel>
          <FieldDescription>
            In OBS, open Settings → Stream, choose the Custom service, and paste in the server and stream key.
          </FieldDescription>
          <CopyField label="Server" value={settings.server} />
          {settings.streamKey && (
            <>
              <CopyField label="Stream key" value={settings.streamKey} masked />
              <FieldDescription>
                Anyone with the stream key can broadcast as this show, so keep it to yourself (and off screen
                while you're live). If it gets out, make a new one: the old one stops working.
              </FieldDescription>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {settings.streamKey ? (
              <>
                <Button variant="outline" disabled={pending} onClick={() => setConfirm('reset')}>
                  <Icons.retry />
                  New stream key
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setConfirm('revoke')}>
                  <Icons.delete />
                  Turn off streaming
                </Button>
              </>
            ) : (
              <Button disabled={pending} onClick={() => void makeKey()}>
                <Icons.securityKey />
                Make a stream key
              </Button>
            )}
          </div>
        </Field>

        <form onSubmit={saveTitle}>
          <Field>
            <FieldLabel htmlFor="live-title">{live ? 'Title of this broadcast' : 'Title of the next broadcast'}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="live-title"
                value={title}
                maxLength={liveTitleMaxLength}
                placeholder={`${show.title} live, with today's date`}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Button type="submit" variant="outline" disabled={pending || title === (settings.liveTitle ?? '')}>
                Save
              </Button>
            </div>
            <FieldDescription>Shown on the live page, and used for the episode made from the recording.</FieldDescription>
          </Field>
        </form>
        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>

      {settings.broadcasts.some((broadcast) => broadcast.endedAt) && (
        <section aria-labelledby="past-broadcasts-heading" className="flex flex-col gap-2 border-t pt-4">
          <h3 id="past-broadcasts-heading" className="text-sm font-semibold">
            Past broadcasts
          </h3>
          <ul className="flex flex-col divide-y">
            {settings.broadcasts
              .filter((broadcast) => broadcast.endedAt)
              .map((broadcast) => (
                <li key={broadcast.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{broadcast.title}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(broadcast.startedAt)} ·{' '}
                      {formatLength(Math.max(60, (broadcast.endedAt!.getTime() - broadcast.startedAt.getTime()) / 1000))}
                    </span>
                  </div>
                  {broadcast.episode ? (
                    <Button variant="outline" size="sm" asChild>
                      {/* Until it's ready, only its manage page shows it. */}
                      <Link
                        to={broadcast.episode.status === 'ready' ? '/$slug/$episodeSlug' : '/$slug/$episodeSlug/manage'}
                        params={{ slug: show.slug, episodeSlug: broadcast.episode.slug }}
                      >
                        {broadcast.episode.status === 'ready' ? 'Episode' : 'Episode (processing)'}
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">No recording</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'reset' ? 'Make a new stream key?' : 'Turn off streaming?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reset'
                ? "The current key stops working, so OBS will need the new one. A broadcast that's on now carries on."
                : "The current key stops working, and you won't be able to go live until you make a new one."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void (confirm === 'reset'
                  ? makeKey()
                  : run(() => revokeMyLiveKey({ data: { showId: show.id } })))
              }
            >
              {confirm === 'reset' ? 'Make a new key' : 'Turn off'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
