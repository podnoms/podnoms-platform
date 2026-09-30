import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createItem, itemsSearchSchema, listItems } from '~/functions/items'

// Search params are parsed and validated by the schema before anything else
// runs; invalid values fall back to defaults instead of throwing.
export const Route = createFileRoute('/_authed/items')({
  validateSearch: itemsSearchSchema,
  // Only the search params the loader actually depends on invalidate its cache.
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listItems({ data: deps }),
  component: Items,
})

function Items() {
  const { items, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const create = useServerFn(createItem)
  const [name, setName] = useState('')
  const pages = Math.max(1, Math.ceil(total / search.pageSize))

  return (
    <main>
      <h1>Items</h1>
      <input
        type="search"
        placeholder="Filter…"
        defaultValue={search.q}
        onChange={(e) => navigate({ search: (s) => ({ ...s, q: e.target.value, page: 1 }), replace: true })}
      />{' '}
      <Link from={Route.fullPath} search={(s) => ({ ...s, sort: s.sort === 'asc' ? 'desc' : 'asc' })}>
        Sort: {search.sort}
      </Link>

      <ul>
        {items.map((i) => (
          <li key={i.id}>
            #{i.id} {i.name}
          </li>
        ))}
      </ul>

      <p>
        <Link from={Route.fullPath} search={(s) => ({ ...s, page: s.page - 1 })} disabled={search.page <= 1}>
          Prev
        </Link>{' '}
        Page {search.page} of {pages}{' '}
        <Link from={Route.fullPath} search={(s) => ({ ...s, page: s.page + 1 })} disabled={search.page >= pages}>
          Next
        </Link>
      </p>

      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await create({ data: { name } })
          setName('')
          await router.invalidate()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New item" required />
        <button type="submit">Add</button>
      </form>
    </main>
  )
}
