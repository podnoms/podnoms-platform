import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { currentDomainSlug } from '~/lib/current-domain'
import type { Tag } from '~/lib/tag-schema'

// Tags link to the site's tag pages. A show's own domain stands alone, so it
// doesn't have them.
export function TagList({ tags, label }: { tags?: Tag[]; label?: string }) {
  if (!tags?.length || currentDomainSlug()) return null

  return (
    <nav aria-label={label ?? 'Tags'} className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {tags.map((tag) => (
        <Badge key={tag.id} variant="secondary" asChild>
          <Link to="/tags/$tagSlug" params={{ tagSlug: tag.slug }} search={{ sort: 'newest' }}>
            #{tag.name}
          </Link>
        </Badge>
      ))}
    </nav>
  )
}
