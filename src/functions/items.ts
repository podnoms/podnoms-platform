// Typed server functions. This file is safe to import from routes/components:
// the compiler replaces each handler with an RPC stub in the client bundle,
// so the `.server` import below never ships to the browser.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { insertItem, queryItems, slowReport } from '~/server/db.server'

export const itemsSearchSchema = z.object({
  // The router JSON-parses search values, so `?q=1` arrives as a number.
  q: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().max(100)).catch(''),
  page: z.number().int().min(1).catch(1),
  pageSize: z.number().int().min(1).max(50).catch(10),
  sort: z.enum(['asc', 'desc']).catch('asc'),
})
export type ItemsSearch = z.infer<typeof itemsSearchSchema>

export const listItems = createServerFn({ method: 'GET' })
  .validator(itemsSearchSchema)
  .handler(({ data }) => queryItems(data))

export const createItem = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(100) }))
  .handler(({ data }) => insertItem(data.name))

export const getServerInfo = createServerFn({ method: 'GET' }).handler(() => ({
  node: process.version,
  renderedAt: new Date().toISOString(),
}))

export const getSlowReport = createServerFn({ method: 'GET' })
  .validator(z.object({ ms: z.number().int().min(0).max(5000) }))
  .handler(({ data }) => slowReport(data.ms))
