import { ErrorComponent, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPendingComponent: () => <p>Loading…</p>,
    defaultErrorComponent: ErrorComponent,
    defaultNotFoundComponent: () => <p>Not found.</p>,
  })
}
