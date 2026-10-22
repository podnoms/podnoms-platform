// The bell in the top bar: everything the user has been told about, or could
// have been, by email or desktop notification (see inbox.server.ts), so
// nothing is missed with those turned off. Its count of unread ones is
// checked every minute while the page is in view, and when it comes back.
// Opening it marks them all read, though they stay highlighted until it's
// next opened.
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { fetchInbox, fetchUnreadCount, markInboxRead } from '~/functions/inbox'
import { formatRelative } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { cn } from '~/lib/utils'
import type { Notification, NotificationKind } from '~/server/inbox.server'

const pollMs = 60_000

const kindIcons: Record<NotificationKind, ComponentType<{ className?: string }>> = {
  episodeFailed: Icons.warning,
  channelEpisodes: Icons.logo,
  live: Icons.broadcast,
  followedEpisodes: Icons.logo,
  mention: Icons.mention,
  reply: Icons.comment,
  botCheck: Icons.warning,
}

export function NotificationsMenu() {
  const { session } = useRouteContext({ from: '__root__' })
  if (!session) return null
  return <Menu />
}

function Menu() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Notification[] | null>(null)
  const [failed, setFailed] = useState(false)

  const refreshCount = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    fetchUnreadCount()
      .then(setUnread)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshCount()
    const timer = setInterval(refreshCount, pollMs)
    document.addEventListener('visibilitychange', refreshCount)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshCount)
    }
  }, [refreshCount])

  async function load() {
    setFailed(false)
    try {
      const inbox = await fetchInbox()
      setItems(inbox.items)
      if (inbox.unread) {
        setUnread(0)
        await markInboxRead({ data: {} })
      }
    } catch {
      setFailed(true)
    }
  }

  function openChange(next: boolean) {
    setOpen(next)
    if (next) void load()
  }

  function go(item: Notification) {
    setOpen(false)
    void router.navigate({ href: item.url })
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Icons.notifications />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {failed ? (
            <p className="p-4 text-sm text-muted-foreground">Your notifications couldn't be loaded. Try again.</p>
          ) : items === null ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 p-6 text-center">
              <Icons.notifications className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing yet</p>
              <p className="text-xs text-muted-foreground">
                Mentions, replies, and news from your podcasts and the ones you follow will show here.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col p-1">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow item={item} onSelect={() => go(item)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ item, onSelect }: { item: Notification; onSelect: () => void }) {
  const KindIcon = kindIcons[item.kind] ?? Icons.notifications
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted',
        !item.read && 'bg-primary/5',
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        {item.image ? (
          <img src={imageSrc(item.image, 40)} alt="" className="size-9 rounded-md object-cover" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-md bg-muted">
            <KindIcon className="size-4 text-muted-foreground" />
          </span>
        )}
        {item.image && (
          <span className="absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full bg-popover ring-1 ring-border">
            <KindIcon className="size-2.5" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
        {item.body && <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>}
        <time dateTime={item.createdAt.toISOString()} className="text-xs text-muted-foreground" suppressHydrationWarning>
          {formatRelative(item.createdAt)}
        </time>
      </span>
      {!item.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </button>
  )
}
