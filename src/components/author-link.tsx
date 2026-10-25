import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

// "by <author>", linking to the profile of the podcast's owner, who made it on
// the site, whether the author is their name or one they've given the podcast.
export function AuthorLink({ author, slug }: { author: string; slug: string }) {
  return (
    <>
      by{' '}
      <Link to="/u/$slug" params={{ slug }} className="text-foreground/80 hover:text-foreground hover:underline">
        {author}
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
