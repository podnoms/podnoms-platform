// The site's links and public origin, from the root route's loader data (see
// fetchSiteLinks), for a route's head() to build absolute URLs with.
export function siteInfo(matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>) {
  const root = matches.find((match) => match.routeId === '__root__')?.loaderData as
    | { siteLinks?: { origin?: string; discordUrl?: string | null } }
    | undefined
  return root?.siteLinks ?? null
}
