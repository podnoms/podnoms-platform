import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { currentDomainSlug } from '~/lib/current-domain'

// "by <author>", linking to the profile of the show's owner, who made it on
// the site, whether the author is their name or one they've given the show.
export function AuthorLink({ author, slug }: { author: string; slug: string }) {
  return (
    <>
      by <AuthorName author={author} slug={slug} className="text-foreground/80 hover:text-foreground hover:underline" />
    </>
  )
}

// The author's name, as a link to that profile, except on the show's own
// domain, which stands alone.
export function AuthorName({ author, slug, className }: { author: string; slug: string; className?: string }) {
  if (currentDomainSlug()) return author
  return (
    <Link to="/u/$slug" params={{ slug }} className={className}>
      {author}
    </Link>
  )
}

// The items that are there, with " · " between them.
export function Separated({ items }: { items: ReactNode[] }) {
  return items
    .filter((item) => item !== null && item !== false && item !== undefined)
    .map((item, index) => (
      <Fragment key={index}>
        {index > 0 && ' · '}
        {item}
      </Fragment>
    ))
}
