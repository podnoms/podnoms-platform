// An admin viewing the site as another user, in one browser tab only (see
// view-as.server.ts). The tab keeps the signed token in sessionStorage, which
// browsers keep per tab, and sends it with its server function calls (the
// middleware in src/start.ts) and its reports of plays and visits. Full page
// loads can't send it, so they render as the admin until the root route
// reloads its data in the browser.
export const viewAsHeader = 'x-view-as'

const storageKey = 'viewAs'

export function viewAsToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}

export function setViewAsToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(storageKey, token)
    else window.sessionStorage.removeItem(storageKey)
  } catch {
    // Without storage the tab just stays as the admin.
  }
}

// Headers for a request from this tab.
export function viewAsHeaders(): Record<string, string> {
  const token = viewAsToken()
  return token ? { [viewAsHeader]: token } : {}
}
