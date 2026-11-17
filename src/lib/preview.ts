// The visitor's view (`?preview=true`, kept as links are followed): a
// signed-in user seeing pages exactly as someone signed out does, as the
// manage page's "Public page" button and the Theme tab open them. The server
// treats the tab as signed out (see getSession and fetchAuthState): a full
// page load by its address, and its server function calls by this header,
// which the middleware in src/start.ts adds. Its plays aren't counted.
export const previewHeader = 'x-preview'

// Whether this tab is showing the visitor's view.
export function inPreview(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('preview') === 'true'
}

// Headers for a server function call from this tab.
export function previewHeaders(): Record<string, string> {
  return inPreview() ? { [previewHeader]: '1' } : {}
}

// Whether a request comes from the visitor's view: a page asked for with
// `?preview=true` (and what it loads while rendering), or a call from such a tab.
export function isPreviewRequest(request: Request): boolean {
  if (request.headers.get(previewHeader) === '1') return true
  try {
    return new URL(request.url).searchParams.get('preview') === 'true'
  } catch {
    return false
  }
}
