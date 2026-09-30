import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

// ssr: false — neither loader nor component runs on the server; the route is
// rendered entirely in the browser (the root document is still SSR'd).
export const Route = createFileRoute('/_authed/client-only')({
  ssr: false,
  loader: () => ({ visits: Number(localStorage.getItem('visits') ?? 0) + 1 }),
  pendingComponent: () => <p>Loading in the browser…</p>,
  component: ClientOnly,
})

function ClientOnly() {
  const { visits } = Route.useLoaderData()
  const [count] = useState(() => {
    localStorage.setItem('visits', String(visits))
    return visits
  })
  return (
    <main>
      <h1>Client-only</h1>
      <p>You have visited this page {count} time(s) in this browser.</p>
    </main>
  )
}
