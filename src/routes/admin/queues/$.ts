import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { jobBoard } from '~/server/job-board.server'
import { isAdmin } from '~/server/users.server'

// The job queue's web UI (Bull Board), for admins only.
async function handle({ request }: { request: Request }) {
  const session = await getSession(request)
  if (!session?.user?.id) {
    return request.method === 'GET'
      ? Response.redirect(new URL('/?login=true', request.url), 302)
      : new Response('You need to be signed in', { status: 401 })
  }
  if (!(await isAdmin(session.user.id))) return new Response('Admins only', { status: 403 })

  const board = await jobBoard()
  if (!board) return new Response('The job queue is not running: REDIS_URL is not set.', { status: 503 })
  return board.fetch(request)
}

export const Route = createFileRoute('/admin/queues/$')({
  server: {
    handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle },
  },
})
