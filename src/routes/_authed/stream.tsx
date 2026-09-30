import { Suspense } from 'react'
import { Await, createFileRoute } from '@tanstack/react-router'
import { getServerInfo, getSlowReport } from '~/functions/items'

// Streaming SSR: awaited data blocks the initial shell; the un-awaited promise
// is serialized into the stream and resolves into the <Suspense> boundary
// once it settles — on the server during SSR, or on the client after navigation.
export const Route = createFileRoute('/_authed/stream')({
  loader: async () => {
    const slow = getSlowReport({ data: { ms: 1500 } })
    const fast = await getServerInfo()
    return { fast, slow }
  },
  component: Stream,
})

function Stream() {
  const { fast, slow } = Route.useLoaderData()
  return (
    <main>
      <h1>Streaming</h1>
      <p>Shell rendered at {fast.renderedAt}.</p>
      <Suspense fallback={<p>Generating report…</p>}>
        <Await promise={slow}>
          {(r) => (
            <p>
              Report: {r.count} items, generated at {r.generatedAt} on {r.runtime}.
            </p>
          )}
        </Await>
      </Suspense>
    </main>
  )
}
