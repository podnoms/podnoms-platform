// Who a show is by, as the site's pages say: the author its owner has given
// it (often a station or band rather than themselves), else their @slug, the
// account's identity on the site, as in its address and @mentions. Never the
// account's name. Feeds and directories use showAuthor instead, which falls
// back to the name, as an @slug isn't a name to podcast apps.
export function showByline(show: { credit: string | null; ownerSlug: string }) {
  return show.credit?.trim() || `@${show.ownerSlug}`
}
