import { useEffect, useState } from 'react'
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { likeEpisode } from '~/functions/library'
import { formatCount } from '~/lib/format'
import { cn } from '~/lib/utils'

// A heart with the episode's like count. It changes as soon as it's pressed,
// and goes back if saving fails. Signed-out visitors are asked to sign in.
export function LikeButton({
  episodeId,
  liked: initialLiked,
  likeCount: initialCount,
  variant = 'ghost',
  className,
}: {
  episodeId: string
  liked: boolean
  likeCount: number
  variant?: 'ghost' | 'outline'
  className?: string
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const router = useRouter()
  const [state, setState] = useState({ liked: initialLiked, likeCount: initialCount })
  const [saving, setSaving] = useState(false)
  // A reload (or the same episode elsewhere on the page) brings newer counts.
  useEffect(() => setState({ liked: initialLiked, likeCount: initialCount }), [initialLiked, initialCount])

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
      size="sm"
      aria-pressed={state.liked}
      disabled={saving}
      onClick={toggle}
      title={label}
      className={cn('gap-1.5 tabular-nums disabled:opacity-100', className)}
    >
      <Icons.like className={cn(state.liked && 'fill-rose-500 text-rose-500')} />
      <span className="sr-only">{label}</span>
      {/* The count, or nothing until someone likes it. */}
      {state.likeCount > 0 && <span>{formatCount(state.likeCount)}</span>}
    </Button>
  )
}
