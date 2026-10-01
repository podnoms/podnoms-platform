import { useEffect, useState } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '~/components/ui/popover'

// Shows the podcast's RSS feed URL, ready to copy into a podcast app.
export function FeedUrlButton({ feedUrl }: { feedUrl: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
    } catch {
      // Clipboard access can be refused; the URL is selectable in the field.
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Icons.rss />
          RSS URL
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>RSS feed</PopoverTitle>
          <PopoverDescription>Add this URL to a podcast app to subscribe.</PopoverDescription>
        </PopoverHeader>
        <InputGroup>
          <InputGroupInput
            aria-label="RSS feed URL"
            readOnly
            value={feedUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={copy} title="Copy URL">
              {copied ? <Icons.check /> : <Icons.copy />}
              <span className="sr-only">{copied ? 'Copied' : 'Copy URL'}</span>
            </InputGroupButton>
            <InputGroupButton size="icon-xs" asChild title="Open feed">
              <a href={feedUrl} target="_blank" rel="noreferrer">
                <Icons.externalLink />
                <span className="sr-only">Open feed</span>
              </a>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </PopoverContent>
    </Popover>
  )
}
