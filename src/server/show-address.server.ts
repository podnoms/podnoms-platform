// Show pages' addresses that are out of date.
import '@tanstack/react-start/server-only'
import { notFound, redirect } from '@tanstack/react-router'
import type { ShowRef } from '~/lib/paths'
import { movedShow } from '~/server/shows.server'

// For a show that isn't at `ref`: a redirect to where it is now, if it or its
// owner has a new slug (`path` gives the page there), else not found.
export async function showMovedOrNotFound(ref: ShowRef, path: (show: ShowRef) => string): Promise<never> {
  const moved = await movedShow(ref)
  if (moved) throw redirect({ href: path(moved), statusCode: 301 })
  throw notFound()
}
