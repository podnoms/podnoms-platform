import { useState } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { startViewingAs, stopViewingAs } from '~/functions/view-as'

// Shown on every page while an admin views the site as another user (see
// view-as.server.ts), floating above the player so it's never out of sight.
export function ViewAsBanner({ name }: { name: string }) {
  const [stopping, setStopping] = useState(false)

  async function stop() {
    setStopping(true)
    try {
      await stopViewingAs()
    } finally {
      // A full load, so nothing of theirs stays in the router's cache.
      window.location.assign('/admin?tab=users')
    }
  }

  return (
    <div
      role="status"
      className="fixed bottom-[calc(var(--player-height,0px)+1rem)] left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg"
    >
      <Icons.show className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        Viewing as <strong className="font-medium">{name}</strong>
        <span className="text-muted-foreground"> · read-only</span>
      </span>
      <Button size="sm" variant="secondary" className="rounded-full" disabled={stopping} onClick={() => void stop()}>
        Stop
      </Button>
    </div>
  )
}

// Starts viewing the site as a user, then opens their home page.
export async function viewSiteAs(userId: string) {
  await startViewingAs({ data: { userId } })
  window.location.assign('/')
}
