import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { reportActivity } from '~/lib/activity'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '~/components/ui/popover'

// Where a share is reported as coming from, for the podcast's stats.
type ShareSource = 'web' | 'listen'

// The episode page's link, ready to copy. Copying it counts as a share.
export function ShareButton({ url, episodeId, source }: { url: string; episodeId: string; source: ShareSource }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Icons.share />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Share this episode</PopoverTitle>
          <PopoverDescription>Anyone with the link can listen.</PopoverDescription>
        </PopoverHeader>
        <CopyField
          label="Episode link"
          value={url}
          onCopy={() => reportActivity(episodeId, { type: 'share', source, detail: 'link' })}
        />
      </PopoverContent>
    </Popover>
  )
}

// The height /embed pages are laid out for.
export const embedHeight = 180

// HTML for putting the episode's player on another site.
export function embedSnippet(embedUrl: string, title: string) {
  const escaped = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<iframe src="${embedUrl}" title="${escaped}" width="100%" height="${embedHeight}" style="border:0;border-radius:12px" loading="lazy" allow="autoplay"></iframe>`
}

export function EmbedButton({
  embedUrl,
  title,
  episodeId,
  source,
}: {
  embedUrl: string
  title: string
  episodeId: string
  source: ShareSource
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Embed">
          <Icons.embed />
          <span className="sr-only">Embed</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>Embed this episode</PopoverTitle>
          <PopoverDescription>Paste this into a web page to add a player for it.</PopoverDescription>
        </PopoverHeader>
        <CopyField
          label="Embed code"
          value={embedSnippet(embedUrl, title)}
          onCopy={() => reportActivity(episodeId, { type: 'share', source, detail: 'embed' })}
        />
      </PopoverContent>
    </Popover>
  )
}
