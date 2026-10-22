import { Fragment, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { CommentComposer } from '~/components/comment-composer'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { likeComment, postComment, removeComment } from '~/functions/comments'
import { commentMaxLength } from '~/lib/comment-schema'
import type { ChatGif, GifConfig } from '~/lib/gifs'
import { formatClock, formatRelative, initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { storedMentionPattern, type CommentMentions } from '~/lib/user-slug'
import { cn } from '~/lib/utils'
import type { CommentReply, EpisodeComment } from '~/server/comments.server'

// How long after its time a comment stays highlighted while the episode plays.
const highlightSeconds = 10

type AnyComment = EpisodeComment | CommentReply

// Asks a signed-out visitor to sign in, staying on the page.
function useSignIn() {
  const navigate = useNavigate()
  return () => navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) })
}

// Posting a comment or reply, for the forms here and the box that opens from
// the waveform. `post` returns whether it was saved.
function usePostComment(episodeId: string, onChange: (comments: EpisodeComment[]) => void) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function post(body: string, gif: ChatGif | null, atSeconds: number, parentId?: string) {
    if (!body.trim() && !gif) return false
    setSaving(true)
    setError(null)
    try {
      onChange(await postComment({ data: { episodeId, body, gif: gif ?? undefined, atSeconds, parentId } }))
      return true
    } catch {
      setError("Your comment couldn't be saved. Try again.")
      return false
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, clearError: () => setError(null), post }
}

// Ctrl/⌘+Enter sends.
function submitOnCtrlEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
}

// The box that opens where the listener clicked the waveform's comment band,
// for a comment at that point. Signed-out visitors are asked to sign in.
export function WaveformCommentBox({
  episodeId,
  atSeconds,
  gifs,
  onChange,
  onDone,
}: {
  episodeId: string
  atSeconds: number
  gifs: GifConfig | null
  onChange: (comments: EpisodeComment[]) => void
  onDone: () => void
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const signIn = useSignIn()
  const [body, setBody] = useState('')
  const [gif, setGif] = useState<ChatGif | null>(null)
  const { saving, error, clearError, post } = usePostComment(episodeId, onChange)
  const at = Math.floor(atSeconds)

  if (!session) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">Sign in to comment at {formatClock(at)}.</p>
        <Button size="sm" className="w-fit" onClick={signIn}>
          Sign in
        </Button>
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await post(body, gif, at)) onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <CommentComposer
        gif={gif}
        onGifChange={setGif}
        gifs={gifs}
        aria-label={`Comment at ${formatClock(at)}`}
        placeholder={`Comment at ${formatClock(at)}…`}
        className="min-h-16"
        value={body}
        maxLength={commentMaxLength}
        onValueChange={(value) => {
          setBody(value)
          clearError()
        }}
        onKeyDown={submitOnCtrlEnter}
      />
      <div className="flex items-center justify-between gap-2">
        {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || (!body.trim() && !gif)}>
            Comment
          </Button>
        </div>
      </div>
    </form>
  )
}

// A comment's text, its mentions as links to the users' profiles.
function CommentBody({ body, mentions }: { body: string; mentions: CommentMentions }) {
  const parts = body.split(storedMentionPattern)
  return (
    <p className="text-sm break-words whitespace-pre-line">
      {parts.map((part, index) => {
        // split() puts each captured user id at the odd places.
        if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>
        const user = mentions[part]
        if (!user) return <Fragment key={index}>{`<@${part}>`}</Fragment>
        return (
          <Link key={index} to="/u/$slug" params={{ slug: user.slug }} className="font-medium text-primary hover:underline">
            @{user.slug}
          </Link>
        )
      })}
    </p>
  )
}

// An episode's comments, in the order they come in it, each with its replies
// under it, and a box to add one at the point the listener has got to.
// Pressing a comment's time plays from there. Signed-in users can reply and
// like comments; signed-out visitors are asked to sign in.
export function EpisodeComments({
  episodeId,
  comments,
  gifs,
  onChange,
  position,
  playing,
  onSeek,
}: {
  episodeId: string
  comments: EpisodeComment[]
  // The site's GIF provider, for GIFs in comments.
  gifs: GifConfig | null
  onChange: (comments: EpisodeComment[]) => void
  // Where the listener is in the episode, and whether it's playing.
  position: number
  playing: boolean
  onSeek: (seconds: number) => void
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const signIn = useSignIn()
  const [body, setBody] = useState('')
  const [gif, setGif] = useState<ChatGif | null>(null)
  // Where the listener was when they started writing, which is what they're
  // commenting on; until then, wherever they are.
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const { saving, error, clearError, post } = usePostComment(episodeId, onChange)
  const atSeconds = Math.floor(startedAt ?? position)
  // The thread being replied to, and what the reply starts with.
  const [replying, setReplying] = useState<{ threadId: string; prefill: string } | null>(null)
  const total = comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)

  // The point being commented on is fixed once there's something to say.
  function started(hasContent: boolean) {
    clearError()
    if (!hasContent) setStartedAt(null)
    else if (startedAt === null) setStartedAt(position)
  }

  function edit(value: string) {
    setBody(value)
    started(Boolean(value.trim() || gif))
  }

  function attach(value: ChatGif | null) {
    setGif(value)
    started(Boolean(body.trim() || value))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!(await post(body, gif, atSeconds))) return
    setBody('')
    setGif(null)
    setStartedAt(null)
  }

  // Applies a change to one comment or reply, wherever it is.
  const update = (id: string, change: Partial<Pick<AnyComment, 'liked' | 'likeCount'>>) =>
    onChange(
      comments.map((comment) =>
        comment.id === id
          ? { ...comment, ...change }
          : { ...comment, replies: comment.replies.map((reply) => (reply.id === id ? { ...reply, ...change } : reply)) },
      ),
    )

  async function like(comment: AnyComment) {
    if (!session) return signIn()
    const liked = !comment.liked
    update(comment.id, { liked, likeCount: comment.likeCount + (liked ? 1 : -1) })
    try {
      update(comment.id, await likeComment({ data: { commentId: comment.id, like: liked } }))
    } catch {
      update(comment.id, { liked: comment.liked, likeCount: comment.likeCount })
    }
  }

  async function remove(commentId: string) {
    const before = comments
    onChange(
      comments
        .filter((comment) => comment.id !== commentId)
        .map((comment) => ({ ...comment, replies: comment.replies.filter((reply) => reply.id !== commentId) })),
    )
    try {
      await removeComment({ data: { commentId } })
    } catch {
      onChange(before)
    }
  }

  // Replying to a reply starts with @ its writer, as it joins the same thread.
  function reply(thread: EpisodeComment, to: AnyComment) {
    if (!session) return signIn()
    setReplying({ threadId: thread.id, prefill: to.id === thread.id ? '' : `@${to.author.slug} ` })
  }

  const item = (comment: AnyComment, thread: EpisodeComment) => (
    <CommentItem
      comment={comment}
      isReply={comment.id !== thread.id}
      current={
        comment.id === thread.id && playing && position >= comment.atSeconds && position < comment.atSeconds + highlightSeconds
      }
      onSeek={onSeek}
      onLike={() => void like(comment)}
      onReply={() => reply(thread, comment)}
      onDelete={() => void remove(comment.id)}
    />
  )

  return (
    <section className="flex flex-col gap-4" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="text-lg font-semibold">
        {total ? pluralise(total, 'comment') : 'Comments'}
      </h2>

      {session ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <CommentComposer
            gif={gif}
            onGifChange={attach}
            gifs={gifs}
            aria-label="Comment"
            placeholder={`Comment at ${formatClock(atSeconds)}… (@ to mention someone)`}
            value={body}
            maxLength={commentMaxLength}
            onValueChange={edit}
            onKeyDown={submitOnCtrlEnter}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving || (!body.trim() && !gif)}>
              <Icons.comment />
              Comment at <span className="tabular-nums">{formatClock(atSeconds)}</span>
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </form>
      ) : (
        <Button variant="outline" className="w-fit" onClick={signIn}>
          <Icons.comment />
          Sign in to comment
        </Button>
      )}

      {comments.length > 0 && (
        <ol className="flex flex-col">
          {comments.map((thread) => (
            <li key={thread.id} className="flex flex-col">
              {item(thread, thread)}
              {(thread.replies.length > 0 || replying?.threadId === thread.id) && (
                <ol className="ml-11 flex flex-col border-l pl-3">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>{item(reply, thread)}</li>
                  ))}
                  {replying?.threadId === thread.id && (
                    <li className="py-2">
                      <ReplyForm
                        key={`${thread.id}-${replying.prefill}`}
                        episodeId={episodeId}
                        gifs={gifs}
                        thread={thread}
                        prefill={replying.prefill}
                        onChange={onChange}
                        onDone={() => setReplying(null)}
                      />
                    </li>
                  )}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CommentItem({
  comment,
  isReply,
  current,
  onSeek,
  onLike,
  onReply,
  onDelete,
}: {
  comment: AnyComment
  isReply: boolean
  current: boolean
  onSeek: (seconds: number) => void
  onLike: () => void
  onReply: () => void
  onDelete: () => void
}) {
  const name = comment.author.name ?? `@${comment.author.slug}`
  return (
    <div
      id={`comment-${comment.id}`}
      className={cn('group flex scroll-mt-20 gap-3 rounded-lg px-2 py-3 transition-colors', current && 'bg-primary/10')}
    >
      <Link to="/u/$slug" params={{ slug: comment.author.slug }} className="shrink-0" tabIndex={-1}>
        <Avatar className={isReply ? 'size-6' : 'size-8'}>
          {comment.author.image && <AvatarImage src={imageSrc(comment.author.image, 32)} alt="" />}
          <AvatarFallback className="text-xs">{initials(comment.author.name, null)}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link to="/u/$slug" params={{ slug: comment.author.slug }} className="font-medium hover:underline">
            {name}
          </Link>
          {!isReply && (
            <button
              type="button"
              onClick={() => onSeek(comment.atSeconds)}
              className="text-xs font-medium text-primary tabular-nums hover:underline"
              title={`Play from ${formatClock(comment.atSeconds)}`}
            >
              at {formatClock(comment.atSeconds)}
            </button>
          )}
          <time dateTime={comment.createdAt.toISOString()} className="text-xs text-muted-foreground" suppressHydrationWarning>
            {formatRelative(comment.createdAt)}
          </time>
        </p>
        {comment.body && <CommentBody body={comment.body} mentions={comment.mentions} />}
        {comment.gif && (
          // Loaded straight from the provider, as its terms require.
          <img
            src={comment.gif.url}
            width={comment.gif.width}
            height={comment.gif.height}
            alt={comment.gif.title || 'GIF'}
            loading="lazy"
            className="mt-1 h-auto w-full max-w-60 rounded-md"
          />
        )}
        <div className="-ml-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', comment.liked && 'text-primary')}
            aria-pressed={comment.liked}
            title={comment.liked ? 'Unlike' : 'Like'}
            onClick={onLike}
          >
            <Icons.like className={cn('size-3.5', comment.liked && 'fill-current')} />
            {comment.likeCount > 0 && <span className="tabular-nums">{comment.likeCount}</span>}
            <span className="sr-only">{comment.liked ? 'Unlike' : 'Like'}</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReply}>
            Reply
          </Button>
        </div>
      </div>
      {comment.canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          title={isReply ? 'Delete reply' : 'Delete comment and its replies'}
          onClick={onDelete}
        >
          <Icons.delete />
          <span className="sr-only">{isReply ? 'Delete reply' : 'Delete comment'}</span>
        </Button>
      )}
    </div>
  )
}

function ReplyForm({
  episodeId,
  gifs,
  thread,
  prefill,
  onChange,
  onDone,
}: {
  episodeId: string
  gifs: GifConfig | null
  thread: EpisodeComment
  prefill: string
  onChange: (comments: EpisodeComment[]) => void
  onDone: () => void
}) {
  const [body, setBody] = useState(prefill)
  const [gif, setGif] = useState<ChatGif | null>(null)
  const { saving, error, clearError, post } = usePostComment(episodeId, onChange)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await post(body, gif, thread.atSeconds, thread.id)) onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <CommentComposer
        gif={gif}
        onGifChange={setGif}
        gifs={gifs}
        autoFocus
        aria-label={`Reply to ${thread.author.name ?? `@${thread.author.slug}`}`}
        placeholder="Reply…"
        className="min-h-16"
        value={body}
        maxLength={commentMaxLength}
        onValueChange={(value) => {
          setBody(value)
          clearError()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
          submitOnCtrlEnter(event)
        }}
        onFocus={(event) => {
          // After the prefilled @mention.
          const end = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(end, end)
        }}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || (!body.trim() && !gif)}>
          Reply
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </form>
  )
}
