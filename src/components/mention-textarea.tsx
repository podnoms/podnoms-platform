// A textarea for writing comments that suggests users to @mention: typing @
// opens a list of users matching what follows it (by username or name),
// which arrow keys move through and Enter or Tab picks, putting @username in
// its place. Escape closes it.
import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type RefObject } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Textarea } from '~/components/ui/textarea'
import { searchMentions } from '~/functions/comments'
import { initials } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { cn } from '~/lib/utils'

type Suggestion = { slug: string; name: string | null; image: string | null }

// An @ being typed at the end of `before` (what's before the caret), and what
// follows it so far.
const typingMention = /(^|[^a-z0-9@])@([a-z0-9-]{0,30})$/i

const searchDelayMs = 150

export function MentionTextarea({
  value,
  onValueChange,
  onKeyDown,
  className,
  textareaRef,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  // For whoever needs the textarea itself, e.g. to insert at the caret.
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const ownTextarea = useRef<HTMLTextAreaElement>(null)
  const textarea = textareaRef ?? ownTextarea
  const listId = useId()
  // Where the @ is, and what's been typed after it, while suggesting.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!mention?.query) {
      setSuggestions([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      searchMentions({ data: { query: mention.query } })
        .then((found) => {
          if (!current) return
          setSuggestions(found)
          setActive(0)
        })
        .catch(() => current && setSuggestions([]))
    }, searchDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [mention?.query])

  // Works out whether an @ is being typed, from the text before the caret.
  function update(text: string, caret: number) {
    const match = typingMention.exec(text.slice(0, caret))
    setMention(match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null)
  }

  function pick(suggestion: Suggestion) {
    if (!mention || !textarea.current) return
    const caret = textarea.current.selectionStart
    const inserted = `@${suggestion.slug} `
    const next = value.slice(0, mention.start) + inserted + value.slice(caret)
    onValueChange(next)
    setMention(null)
    const at = mention.start + inserted.length
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(at, at)
    })
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((index) => (index + step + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(suggestions[active]!)
        return
      }
    }
    if (mention && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setMention(null)
      return
    }
    onKeyDown?.(event)
  }

  const open = mention !== null
  const optionId = (index: number) => `${listId}-${index}`

  return (
    <div className="relative">
      <Textarea
        ref={textarea}
        value={value}
        className={className}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions.length ? optionId(active) : undefined}
        onChange={(event) => {
          onValueChange(event.target.value)
          update(event.target.value, event.target.selectionStart)
        }}
        onSelect={(event) => update(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        onKeyDown={keyDown}
        {...props}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="People to mention"
          className="absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {!mention.query ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Type a name or username</p>
          ) : suggestions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No one matches</p>
          ) : (
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion.slug}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  index === active && 'bg-muted',
                )}
                onMouseEnter={() => setActive(index)}
                // Before the textarea's blur closes the list.
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(suggestion)
                }}
              >
                <Avatar className="size-6">
                  {suggestion.image && <AvatarImage src={imageSrc(suggestion.image, 32)} alt="" />}
                  <AvatarFallback className="text-[10px]">{initials(suggestion.name, null)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate">{suggestion.name ?? suggestion.slug}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">@{suggestion.slug}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
