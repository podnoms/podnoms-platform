import { createFileRoute, Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { LiveChat } from '~/components/live-chat'
import { LiveEndDialog } from '~/components/live-end-dialog'
import { LivePlayer } from '~/components/live-player'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { fetchLivePage } from '~/functions/live'
import { useLiveEvents } from '~/hooks/use-live-events'
import { formatCount } from '~/lib/format'

// A podcast's live page, at /live/:slug: its broadcast from OBS
// while there is one, and the chat beside it. It follows the broadcast
// starting and ending without a reload.
export const Route = createFileRoute('/live/$slug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchLivePage({ data: { slug: params.slug } }),
  head: ({ loaderData: page }) =>
    page
      ? {
          meta: [
            { title: `${page.podcast.title} live · podnoms` },
            ...(page.podcast.private ? [{ name: 'robots', content: 'noindex' }] : []),
          ],
        }
      : {},
  component: LivePage,
})

const startedFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function LivePage() {
  const page = Route.useLoaderData()
  const { podcast } = page
  const { broadcast, chat, setChat, viewers, ended } = useLiveEvents(podcast.slug, page)
  const interrupted = Boolean(broadcast?.interruptedAt)

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 md:p-6 xl:h-[calc(100dvh-var(--top-nav-height,0px)-var(--player-height,0px))] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <LivePlayer
          slug={podcast.slug}
          broadcastId={broadcast?.id ?? null}
          artwork={podcast.imageUrl}
          interrupted={interrupted}
          ended={ended}
        />
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              {broadcast && interrupted ? (
                <Badge variant="secondary">Reconnecting…</Badge>
              ) : broadcast ? (
                <Badge className="bg-destructive text-destructive-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-destructive-foreground" />
                  Live
                </Badge>
              ) : (
                <Badge variant="secondary">{ended ? 'Ended' : 'Offline'}</Badge>
              )}
              {broadcast && viewers !== null && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                  <Icons.viewers className="size-4" />
                  {formatCount(viewers)}
                  <span className="sr-only">watching</span>
                </span>
              )}
              {broadcast && (
                <span className="text-sm text-muted-foreground" suppressHydrationWarning>
                  since {startedFormat.format(broadcast.startedAt)}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">{broadcast?.title ?? podcast.title}</h1>
            <p className="text-sm text-muted-foreground">
              {podcast.title}
              {podcast.author && ` · by ${podcast.author}`}
            </p>
          </div>
          <div className="flex gap-2">
            {page.isOwner && (
              <Button variant="outline" asChild>
                <Link to="/podcasts/$slug/manage" params={{ slug: podcast.slug }}>
                  <Icons.settings />
                  Manage
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/podcasts/$slug" params={{ slug: podcast.slug }}>
                <Icons.logo />
                Episodes
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <LiveChat
        broadcastId={broadcast?.id ?? null}
        messages={chat}
        onChange={setChat}
        className="h-[28rem] xl:h-auto"
      />
      {page.isOwner && <LiveEndDialog broadcast={broadcast} graceMinutes={page.reconnectGraceMinutes} />}
    </div>
  )
}
