// The show whose own domain this page is on, or null on the site itself. On
// the server the custom-domain middleware (see src/start.ts) works it out for
// each request; the page then records it on <html data-custom-domain> as
// "<owner>/<show>" (see __root.tsx) for the browser to read.
import { createIsomorphicFn } from '@tanstack/react-start'
import type { ShowRef } from '~/lib/paths'

// Set by custom-domains.server.ts; kept on globalThis so this shared module
// needn't import server code.
type DomainContext = { getStore: () => ShowRef | undefined }
const server = globalThis as { podnomsCustomDomain?: DomainContext }

export const currentDomainShow = createIsomorphicFn()
  .server((): ShowRef | null => server.podnomsCustomDomain?.getStore() ?? null)
  .client((): ShowRef | null => parseDomainShow(document.documentElement.dataset.customDomain))

// Whether this page is on a show's own domain, which has no accounts: so
// nothing on it asks anyone to sign in or leads to the site.
export const isCustomDomain = () => currentDomainShow() !== null

// How the show is written on <html data-custom-domain>, and read back.
export function domainShowAttribute(show: ShowRef) {
  return `${show.ownerSlug}/${show.slug}`
}

export function parseDomainShow(value: string | undefined): ShowRef | null {
  const [ownerSlug, slug] = value?.split('/') ?? []
  return ownerSlug && slug ? { ownerSlug, slug } : null
}
