import { useState, type FormEvent } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { postComment, removeComment } from '~/functions/comments'
import { commentMaxLength } from '~/lib/comment-schema'
import { formatClock, formatRelative, initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { cn } from '~/lib/utils'
import type { EpisodeComment } from '~/server/comments.server'

// How long after its time a comment stays highlighted while the episode plays.
const highlightSeconds = 10

// An episode's comments, in the order they come in it, and a box to add one
// at the point the listener has got to. Pressing a comment's time plays from
// there. Signed-out visitors are asked to sign in.
export function EpisodeComments({
  episodeId,
  comments,
  onChange,
  position,
  playing,
  onSeek,
}: {
  episodeId: string
  comments: EpisodeComment[]
  onChange: (comments: EpisodeComment[]) => void
  // Where the listener is in the episode, and whether it's playing.
  position: number
  playing: boolean
  onSeek: (seconds: number) => void
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [body, setBody] = useState('')
  // Where the listener was when they started writing, which is what they're
  // commenting on; until then, wherever they are.
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const atSeconds = Math.floor(startedAt ?? position)

  function edit(value: string) {
    setBody(value)
    setError(null)
    if (!value.trim()) setStartedAt(null)
    else if (startedAt === null) setStartedAt(position)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    try {
      onChange(await postComment({ data: { episodeId, body, atSeconds } }))
      setBody('')
      setStartedAt(null)
    } catch {
      setError("Your comment couldn't be saved. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function remove(commentId: string) {
    const before = comments
    onChange(comments.filter((comment) => comment.id !== commentId))
    try {
      await removeComment({ data: { commentId } })
    } catch {
      onChange(before)
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="text-lg font-semibold">
        {comments.length ? pluralise(comments.length, 'comment') : 'Comments'}
      </h2>

      {session ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Textarea
            aria-label="Comment"
            placeholder={`Comment at ${formatClock(atSeconds)}…`}
            value={body}
            maxLength={commentMaxLength}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
            }}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving || !body.trim()}>
              <Icons.comment />
              Comment at <span className="tabular-nums">{formatClock(atSeconds)}</span>
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) })}
        >
          <Icons.comment />
          Sign in to comment
        </Button>
      )}

      {comments.length > 0 && (
        <ol className="flex flex-col">
          {comments.map((comment) => {
            const current =
              playing && position >= comment.atSeconds && position < comment.atSeconds + highlightSeconds
            const name = comment.author.name ?? 'A listener'
            return (
              <li
                key={comment.id}
                className={cn(
                  'group flex gap-3 rounded-lg px-2 py-3 transition-colors',
                  current && 'bg-primary/10',
                )}
              >
                <Avatar className="size-8">
                  {comment.author.image && <AvatarImage src={imageSrc(comment.author.image, 32)} alt="" />}
                  <AvatarFallback className="text-xs">{initials(comment.author.name, null)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{name}</span>
                    <button
                      type="button"
                      onClick={() => onSeek(comment.atSeconds)}
                      className="text-xs font-medium text-primary tabular-nums hover:underline"
                      title={`Play from ${formatClock(comment.atSeconds)}`}
                    >
                      at {formatClock(comment.atSeconds)}
                    </button>
                    <time
                      dateTime={comment.createdAt.toISOString()}
                      className="text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatRelative(comment.createdAt)}
                    </time>
                  </p>
                  <p className="text-sm break-words whitespace-pre-line">{comment.body}</p>
                </div>
                {comment.canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    title="Delete comment"
                    onClick={() => remove(comment.id)}
                  >
                    <Icons.delete />
                    <span className="sr-only">Delete comment</span>
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
