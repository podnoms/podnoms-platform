// Writing a comment, as in WhatsApp: a box that suggests users to @mention,
// with a smiley button (bottom left, inside it) opening a panel of emoji and (when the site has a GIF
// provider) GIFs. An emoji goes in where the caret was; a GIF is attached to
// the comment, shown under the box until it's sent or removed, so it can go
// with words or alone.
import { useRef, useState, type ComponentProps } from 'react'
import { GifSearch } from '~/components/gif-picker'
import { Icons } from '~/components/icons'
import { MentionTextarea } from '~/components/mention-textarea'
import { Button } from '~/components/ui/button'
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from '~/components/ui/emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { ChatGif, GifConfig } from '~/lib/gifs'
import { cn } from '~/lib/utils'

export function CommentComposer({
  value,
  onValueChange,
  gif,
  onGifChange,
  gifs,
  className,
  ...props
}: Omit<ComponentProps<typeof MentionTextarea>, 'textareaRef'> & {
  gif: ChatGif | null
  onGifChange: (gif: ChatGif | null) => void
  // The site's GIF provider; without one, just emoji.
  gifs: GifConfig | null
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)

  // Puts the emoji where the caret was (or at the end), and the caret after it.
  function insertEmoji(emoji: string) {
    const element = textarea.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    onValueChange(value.slice(0, start) + emoji + value.slice(end))
    const caret = start + emoji.length
    requestAnimationFrame(() => textarea.current?.setSelectionRange(caret, caret))
  }

  const emojiPicker = (
    <EmojiPicker className="h-80 w-full" onEmojiSelect={({ emoji }) => insertEmoji(emoji)}>
      <EmojiPickerSearch placeholder="Search emoji…" />
      <EmojiPickerContent />
      <EmojiPickerFooter />
    </EmojiPicker>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <MentionTextarea
          textareaRef={textarea}
          value={value}
          onValueChange={onValueChange}
          // Room under the text for the button.
          className={cn('pb-10', className)}
          {...props}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute bottom-1.5 left-1.5 text-muted-foreground"
              title={gifs ? 'Emoji and GIFs' : 'Emoji'}
            >
              <Icons.emoji />
              <span className="sr-only">{gifs ? 'Add an emoji or GIF' : 'Add an emoji'}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-80 p-0"
            // Typing goes on in the comment box until a search is picked.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              textarea.current?.focus()
            }}
          >
            {gifs ? (
              <Tabs defaultValue="emoji" className="gap-0">
                <TabsList className="m-1.5 grid w-[calc(100%-0.75rem)] grid-cols-2">
                  <TabsTrigger value="emoji">Emoji</TabsTrigger>
                  <TabsTrigger value="gif">GIF</TabsTrigger>
                </TabsList>
                <TabsContent value="emoji">{emojiPicker}</TabsContent>
                <TabsContent value="gif">
                  <GifSearch
                    config={gifs}
                    onPick={(picked) => {
                      onGifChange(picked)
                      setOpen(false)
                    }}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              emojiPicker
            )}
          </PopoverContent>
        </Popover>
      </div>
      {gif && (
        <div className="relative w-fit">
          {/* Loaded straight from the provider, as its terms require. */}
          <img
            src={gif.url}
            width={gif.width}
            height={gif.height}
            alt={gif.title || 'GIF'}
            className="h-auto max-h-40 w-auto max-w-48 rounded-md"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute top-1 right-1 size-6 rounded-full"
            title="Remove the GIF"
            onClick={() => onGifChange(null)}
          >
            <Icons.close className="size-3.5" />
            <span className="sr-only">Remove the GIF</span>
          </Button>
        </div>
      )}
    </div>
  )
}
