import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { showByline } from '~/lib/byline'

// "by <author>", linking to the profile of the show's owner, who made it on
// the site: the author they've given the show, else their @slug (see showByline).
export function AuthorLink({ credit, slug }: { credit: string | null; slug: string }) {
  return (
    <>
      by{' '}
      <Link to="/$user" params={{ user: slug }} className="text-foreground/80 hover:text-foreground hover:underline">
        {showByline({ credit, ownerSlug: slug })}
      </Link>
    </>
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
