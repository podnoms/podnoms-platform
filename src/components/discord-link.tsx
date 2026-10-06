import { useLoaderData } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'

// A link to the community Discord, from DISCORD_SERVER. Hidden when it isn't set.
export function DiscordLink() {
  const discordUrl = useLoaderData({ from: '__root__', select: (data) => data.siteLinks.discordUrl })
  if (!discordUrl) return null
  return (
    <Button variant="ghost" size="icon" asChild>
      <a href={discordUrl} target="_blank" rel="noopener noreferrer" aria-label="Join us on Discord" title="Join us on Discord">
        <Icons.discord />
      </a>
    </Button>
  )
}
