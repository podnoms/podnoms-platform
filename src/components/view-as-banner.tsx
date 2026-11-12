import { useEffect } from 'react'
import { useRouter, type AnyRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { fetchAuthState } from '~/functions/auth'
import { startViewingAs } from '~/functions/view-as'
import { setViewAsToken, viewAsToken } from '~/lib/view-as'

// Shown on every page of a tab where an admin is viewing the site as another
// user (see src/lib/view-as.ts), floating above the player so it's never out
// of sight.
export function ViewAsBanner({ name }: { name: string }) {
  function stop() {
    setViewAsToken(null)
    // A full load, so nothing of theirs stays in the router's cache.
    window.location.assign('/admin?tab=users')
  }

  return (
    <div
      role="status"
      className="fixed bottom-[calc(var(--player-height,0px)+1rem)] left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border bg-popover py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg"
    >
      <Icons.show className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        Viewing as <strong className="font-medium">{name}</strong>
        <span className="text-muted-foreground"> · read-only · this tab</span>
      </span>
      <Button size="sm" variant="secondary" className="rounded-full" onClick={stop}>
        Stop
      </Button>
    </div>
  )
}

// Turns this tab into a view of the site as a user, then opens their home page.
export async function viewSiteAs(router: AnyRouter, userId: string) {
  setViewAsToken(await startViewingAs({ data: { userId } }))
  await router.navigate({ to: '/' })
  // The root route's data (the session, the sidebar's shows) is kept forever.
  await router.invalidate()
}

// A full page load can't send the tab's token, so it's rendered as the admin;
// this then reloads the page's data in the browser, as the user. A token that
// no longer works (expired, say) is dropped.
export function useViewAsTab(viewingAs: boolean) {
  const router = useRouter()
  useEffect(() => {
    if (viewingAs || !viewAsToken()) return
    void fetchAuthState().then(({ session }) => {
      if (session?.viewingAs) return router.invalidate()
      setViewAsToken(null)
    })
    // Only on the first load: after that every request carries the token.
  }, [])
}
