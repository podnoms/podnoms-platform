import { ErrorComponent, createRouter } from '@tanstack/react-router'
import { reportClientError } from '~/lib/client-errors'
import { currentDomainSlug } from '~/lib/current-domain'
import { toDomainPath, toSitePath } from '~/lib/custom-domain'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPendingComponent: () => <p>Loading…</p>,
    defaultErrorComponent: ErrorComponent,
    defaultOnCatch: reportClientError,
    defaultNotFoundComponent: () => <p>Not found.</p>,
    // On a podcast's own domain, "/" is its page and "/episodes/<slug>" its
    // episodes' (see src/lib/custom-domain.ts).
    rewrite: {
      input: ({ url }) => rewritePath(url, toSitePath),
      output: ({ url }) => rewritePath(url, toDomainPath),
    },
  })
}

function rewritePath(url: URL, map: (pathname: string, slug: string) => string | null) {
  const slug = currentDomainSlug()
  const pathname = slug && map(url.pathname, slug)
  if (!pathname) return undefined
  url.pathname = pathname
  return url
}
