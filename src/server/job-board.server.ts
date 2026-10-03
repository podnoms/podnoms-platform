// Bull Board: a web UI for the job queue (see jobs.server.ts), for admins, at
// /admin/queues. Built on its Hono adapter, whose app answers web Requests,
// which is what server routes deal in.
import '@tanstack/react-start/server-only'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { createBullBoard } from '@bull-board/api'
import { HonoAdapter } from '@bull-board/hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { startJobs } from '~/server/jobs.server'

export const jobBoardPath = '/admin/queues'

// The board's page template and static files are read from its UI package.
const uiBasePath = dirname(createRequire(import.meta.url).resolve('@bull-board/ui/package.json'))

let board: Promise<Hono | null> | undefined

// Null when the job queue isn't running (no REDIS_URL).
export function jobBoard() {
  board ??= startJobs().then((running) => {
    if (!running) return null
    const serverAdapter = new HonoAdapter(serveStatic).setBasePath(jobBoardPath)
    createBullBoard({
      queues: [new BullMQAdapter(running.queue)],
      serverAdapter,
      options: { uiBasePath, uiConfig: { boardTitle: 'PodNoms jobs', boardLogo: { path: '/logo.png', width: 32, height: 32 } } },
    })
    return new Hono().route(jobBoardPath, serverAdapter.registerPlugin())
  })
  return board
}
