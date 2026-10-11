import { useEffect, useRef, useState } from 'react'
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { likeEpisode } from '~/functions/library'
import { formatCount } from '~/lib/format'
import { cn } from '~/lib/utils'

// A heart with the episode's like count: beside it, as a badge on its corner,
// or not at all (where it's shown elsewhere). It changes as soon as it's
// pressed, and goes back if saving fails. Signed-out visitors are asked to sign in.
export function LikeButton({
  episodeId,
  liked: initialLiked,
  likeCount: initialCount,
  variant = 'ghost',
  count = 'inline',
  onChange,
  className,
}: {
  episodeId: string
  liked: boolean
  likeCount: number
  variant?: 'ghost' | 'outline'
  // 'hidden' where the count is shown elsewhere, which onChange keeps up to date.
  count?: 'inline' | 'badge' | 'hidden'
  onChange?: (state: { liked: boolean; likeCount: number }) => void
  className?: string
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const router = useRouter()
  const [state, setState] = useState({ liked: initialLiked, likeCount: initialCount })
  const [saving, setSaving] = useState(false)
  // A reload (or the same episode elsewhere on the page) brings newer counts.
  useEffect(() => setState({ liked: initialLiked, likeCount: initialCount }), [initialLiked, initialCount])
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange
  useEffect(() => latestOnChange.current?.(state), [state])

  async function toggle() {
    if (!session) {
      await navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) })
      return
    }
    const before = state
    const liked = !before.liked
    setState({ liked, likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)) })
    setSaving(true)
    try {
      setState(await likeEpisode({ data: { episodeId, liked } }))
      // Other pages showing this episode may be cached, or preloaded when its
      // link was hovered, with the like as it was; have them load afresh. The
      // page this button is on keeps what it has.
      router.clearCache()
    } catch {
      setState(before)
    } finally {
      setSaving(false)
    }
  }

  const label = state.liked ? 'Unlike' : 'Like'
  return (
    <Button
      variant={variant}
      size={count === 'inline' ? 'sm' : 'icon'}
      aria-pressed={state.liked}
      disabled={saving}
      onClick={toggle}
      title={label}
      className={cn('relative tabular-nums disabled:opacity-100', className)}
    >
      <Icons.like className={cn(state.liked && 'fill-rose-500 text-rose-500')} />
      <span className="sr-only">{label}</span>
      {/* The count, or nothing until someone likes it. */}
      {count === 'inline' && state.likeCount > 0 && (
        <span>
          {formatCount(state.likeCount)}
          <span className="sr-only"> likes</span>
        </span>
      )}
      {count === 'badge' && state.likeCount > 0 && (
        <span
          className={cn(
            'pointer-events-none absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2 ring-card',
            state.liked ? 'bg-rose-500 text-white' : 'bg-muted-foreground text-background',
          )}
        >
          {formatCount(state.likeCount)}
          <span className="sr-only"> likes</span>
        </span>
      )}
    </Button>
  )
}
