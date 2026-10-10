// The slug of the podcast whose own domain this page is on, or null on the
// site itself. On the server the custom-domain middleware (see src/start.ts)
// works it out for each request; the page then records it on <html> (see
// __root.tsx) for the browser to read.
import { createIsomorphicFn } from '@tanstack/react-start'

// Set by custom-domains.server.ts; kept on globalThis so this shared module
// needn't import server code.
type DomainContext = { getStore: () => string | undefined }
const server = globalThis as { podnomsCustomDomain?: DomainContext }

export const currentDomainSlug = createIsomorphicFn()
  .server((): string | null => server.podnomsCustomDomain?.getStore() ?? null)
  .client((): string | null => document.documentElement.dataset.customDomain ?? null)
