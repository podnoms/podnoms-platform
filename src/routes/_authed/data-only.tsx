import { createFileRoute } from '@tanstack/react-router'
import { listItems } from '~/functions/items'

// ssr: 'data-only' — the loader runs on the server and its result is shipped
// with the document, but the component renders only on the client. Use for
// UI that depends on browser APIs (canvas, layout measurement) while still
// avoiding a client-side data waterfall.
export const Route = createFileRoute('/_authed/data-only')({
  ssr: 'data-only',
  loader: () => listItems({ data: { q: '', page: 1, pageSize: 50, sort: 'asc' } }),
  pendingComponent: () => <p>Rendering on the client…</p>,
  component: DataOnly,
})

function DataOnly() {
  const { total } = Route.useLoaderData()
  return (
    <main>
      <h1>Data-only SSR</h1>
      <p>
        {total} items (data from server), viewport {window.innerWidth}×{window.innerHeight} (read in the browser).
      </p>
    </main>
  )
}
