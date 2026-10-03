import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { InputGroupButton } from '~/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '~/components/ui/popover'

// Shows the podcast's RSS feed URL, ready to copy into a podcast app.
export function FeedUrlButton({ feedUrl, label = 'RSS URL' }: { feedUrl: string; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Icons.rss />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>RSS feed</PopoverTitle>
          <PopoverDescription>Add this URL to a podcast app to subscribe.</PopoverDescription>
        </PopoverHeader>
        <CopyField label="RSS feed URL" value={feedUrl}>
          <InputGroupButton size="icon-xs" asChild title="Open feed">
            <a href={feedUrl} target="_blank" rel="noreferrer">
              <Icons.externalLink />
              <span className="sr-only">Open feed</span>
            </a>
          </InputGroupButton>
        </CopyField>
      </PopoverContent>
    </Popover>
  )
}
