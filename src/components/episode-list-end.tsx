import type { RefObject } from 'react'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

// Goes after a show page's episode list: what useEpisodePages watches to load
// the next page, with a spinner while it loads and a way to try again.
export function EpisodeListEnd({
  sentinel,
  hasMore,
  loading,
  failed,
  retry,
}: {
  sentinel: RefObject<HTMLDivElement | null>
  hasMore: boolean
  loading: boolean
  failed: boolean
  retry: () => void
}) {
  if (!hasMore && !loading) return null
  return (
    <div ref={sentinel} className="flex min-h-12 items-center justify-center gap-3 text-sm text-muted-foreground">
      {failed ? (
        <>
          Couldn't load more episodes.
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </>
      ) : (
        loading && (
          <>
            <Spinner />
            Loading episodes…
          </>
        )
      )}
    </div>
  )
}
