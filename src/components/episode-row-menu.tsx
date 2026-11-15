import { useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { ignoreShow } from '~/functions/library'

// More things to do with an episode in a listener's list, behind a "⋮"
// button. For now: ignoring its show, so none of its episodes turn up in
// the user's lists again (undone from the Following page). Signed-in only.
export function EpisodeRowMenu({ showId, showTitle }: { showId: string; showTitle: string }) {
  const { session } = useRouteContext({ from: '__root__' })
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  if (!session) return null

  async function ignore() {
    setSaving(true)
    try {
      await ignoreShow({ data: { showId, ignored: true } })
      // Reloads the lists, which leave the show out now.
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={saving} aria-label="More options">
          <Icons.more />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => void ignore()}>
          <Icons.hide />
          <span className="min-w-0 flex-1 truncate">Ignore {showTitle}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
