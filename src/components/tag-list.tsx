import { Link, useLoaderData } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { currentDomainSlug } from '~/lib/current-domain'
import type { Tag } from '~/lib/tag-schema'

// Discovery lives on the site, even when the show has its own domain.
export function TagList({ tags, label }: { tags?: Tag[]; label?: string }) {
  if (!tags?.length) return null
  return <TagLinks tags={tags} label={label} />
}

function TagLinks({ tags, label }: { tags: Tag[]; label?: string }) {
  const { siteLinks } = useLoaderData({ from: '__root__' })
  const origin = currentDomainSlug() ? siteLinks.origin : null

  return (
    <nav aria-label={label ?? 'Tags'} className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {tags.map((tag) => (
        <Badge key={tag.id} variant="secondary" asChild>
          {origin ? (
            <a href={new URL(`/tags/${encodeURIComponent(tag.slug)}`, origin).href}>#{tag.name}</a>
          ) : (
            <Link to="/tags/$tagSlug" params={{ tagSlug: tag.slug }} search={{ sort: 'newest' }}>
              #{tag.name}
            </Link>
          )}
        </Badge>
      ))}
    </nav>
  )
}
