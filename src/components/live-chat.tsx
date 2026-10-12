import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { GifPicker } from '~/components/gif-picker'
import { Icons } from '~/components/icons'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from '~/components/ui/emoji-picker'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { postLiveChat, removeLiveChat } from '~/functions/live'
import type { ChatGif, GifConfig } from '~/lib/gifs'
import { chatMessageMaxLength } from '~/lib/live-schema'
import { initials } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { insertText } from '~/lib/text'
import { cn } from '~/lib/utils'
import type { ChatMessage } from '~/server/live.server'

// Within this many pixels of the bottom counts as reading the newest
// messages, so the list follows new ones; further up, it stays put.
const followSlackPx = 48

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

// A broadcast's chat: messages as they come, and a box to write one while
// it's live. Signed-out visitors are asked to sign in.
export function LiveChat({
  broadcastId,
  messages,
  onChange,
  gifs,
  className,
}: {
  // Null while not live: the chat so far stays, but no one can write.
  broadcastId: string | null
  messages: ChatMessage[]
  // The GIF provider to search, if one is set up.
  gifs: GifConfig | null
  onChange: (update: (messages: ChatMessage[]) => ChatMessage[]) => void
  className?: string
}) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const following = useRef(true)

  useLayoutEffect(() => {
    const element = list.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [messages])

  // Posts some text or a GIF, returning whether it went.
  async function send(message: { body?: string; gif?: ChatGif }) {
    if (!broadcastId) return false
    setSending(true)
    setError(null)
    try {
      const sent = await postLiveChat({ data: { broadcastId, ...message } })
      // The event stream brings it too; whichever comes first is kept.
      onChange((current) => (current.some((m) => m.id === sent.id) ? current : [...current, sent]))
      following.current = true
      return true
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'Slow down a little' ? caught.message : "Your message wasn't sent. Try again.")
      return false
    } finally {
      setSending(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    if (await send({ body })) setBody('')
  }

  // Puts the emoji where the cursor was in the message (or at its end), then
  // goes back to typing just after it. Ignored if the message is full.
  function insertEmoji(emoji: string) {
    const field = input.current
    const inserted = insertText(
      body,
      emoji,
      field?.selectionStart ?? body.length,
      field?.selectionEnd ?? body.length,
      chatMessageMaxLength,
    )
    setPicking(false)
    if (!inserted) return
    setBody(inserted.text)
    setError(null)
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  async function remove(messageId: string) {
    let before: ChatMessage[] = []
    onChange((current) => {
      before = current
      return current.filter((message) => message.id !== messageId)
    })
    try {
      await removeLiveChat({ data: { messageId } })
    } catch {
      onChange(() => before)
    }
  }

  return (
    <section
      aria-labelledby="chat-heading"
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card', className)}
    >
      <h2 id="chat-heading" className="border-b px-4 py-3 text-sm font-semibold">
        Live chat
      </h2>
      <ol
        ref={list}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4"
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < followSlackPx
        }}
      >
        {messages.length === 0 && (
          <li className="m-auto text-center text-sm text-muted-foreground">
            {broadcastId ? 'No messages yet. Say hello!' : 'The chat opens when the broadcast starts.'}
          </li>
        )}
        {messages.map((message) => (
          <li key={message.id} className="group flex gap-2.5">
            <Avatar className="size-7">
              {message.author.image && <AvatarImage src={imageSrc(message.author.image, 32)} alt="" />}
              <AvatarFallback className="text-[10px]">{initials(message.author.name, null)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="flex items-baseline gap-2 text-xs">
                <span className="truncate font-medium">{message.author.name ?? 'A listener'}</span>
                <time
                  dateTime={message.createdAt.toISOString()}
                  className="text-muted-foreground tabular-nums"
                  suppressHydrationWarning
                >
                  {timeFormat.format(message.createdAt)}
                </time>
              </p>
              {message.body && <p className="text-sm break-words whitespace-pre-line">{message.body}</p>}
              {message.gif && (
                // Loaded straight from the provider, as its terms require.
                <img
                  src={message.gif.url}
                  width={message.gif.width}
                  height={message.gif.height}
                  alt={message.gif.title || 'GIF'}
                  loading="lazy"
                  className="mt-1 h-auto w-full max-w-48 rounded-md"
                />
              )}
            </div>
            {message.canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                title="Delete message"
                onClick={() => remove(message.id)}
              >
                <Icons.delete />
                <span className="sr-only">Delete message</span>
              </Button>
            )}
          </li>
        ))}
      </ol>
      <div className="border-t p-3">
        {!session ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) })}
          >
            <Icons.comment />
            Sign in to chat
          </Button>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <Input
                ref={input}
                aria-label="Message"
                placeholder={broadcastId ? 'Say something…' : 'Not live right now'}
                value={body}
                maxLength={chatMessageMaxLength}
                disabled={!broadcastId}
                onChange={(event) => {
                  setBody(event.target.value)
                  setError(null)
                }}
              />
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" disabled={!broadcastId} title="Add an emoji">
                    <Icons.emoji />
                    <span className="sr-only">Add an emoji</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-fit p-0">
                  <EmojiPicker className="h-80" onEmojiSelect={({ emoji }) => insertEmoji(emoji)}>
                    <EmojiPickerSearch placeholder="Search emoji…" />
                    <EmojiPickerContent />
                    <EmojiPickerFooter />
                  </EmojiPicker>
                </PopoverContent>
              </Popover>
              {gifs && <GifPicker config={gifs} disabled={!broadcastId || sending} onPick={(gif) => void send({ gif })} />}
              <Button type="submit" size="icon" disabled={!broadcastId || sending || !body.trim()} title="Send">
                <Icons.send />
                <span className="sr-only">Send</span>
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        )}
      </div>
    </section>
  )
}
