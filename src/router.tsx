import { ErrorComponent, createRouter } from '@tanstack/react-router'
import { reportClientError } from '~/lib/client-errors'
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
  })
}
