// The admin-only job queue UI (Bull Board).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as QueuesRoute } from '~/routes/admin/queues/$'
import { getSession } from '~/server/auth.server'
import { jobBoard } from '~/server/job-board.server'
import { resetDb } from '../db'
import { callRoute, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))
vi.mock('~/server/job-board.server', () => ({ jobBoard: vi.fn() }))

const signedInAs = (id: string) => vi.mocked(getSession).mockResolvedValue({ user: { id }, expires: '' })

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
  vi.mocked(jobBoard).mockReset()
})

const request = (method = 'GET', path = '/admin/queues') => new Request(`http://x${path}`, { method })

describe('/admin/queues', () => {
  it('sends signed-out visitors to sign in', async () => {
    const response = await callRoute(QueuesRoute, 'GET', request())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://x/?login=true')
  })

  it('is 401 for signed-out API calls', async () => {
    expect((await callRoute(QueuesRoute, 'PUT', request('PUT', '/admin/queues/api/queues/jobs/retry/failed'))).status).toBe(401)
  })

  it('is 403 for users who are not admins', async () => {
    await createUser({ id: 'admin', isAdmin: true })
    await createUser({ id: 'user' })
    signedInAs('user')
    const response = await callRoute(QueuesRoute, 'GET', request())
    expect(response.status).toBe(403)
    expect(jobBoard).not.toHaveBeenCalled()
  })

  it('hands admin requests to the board', async () => {
    await createUser({ id: 'admin', isAdmin: true })
    signedInAs('admin')
    const fetch = vi.fn(async () => new Response('board'))
    vi.mocked(jobBoard).mockResolvedValue({ fetch } as never)

    const sent = request('PUT', '/admin/queues/api/queues/jobs/retry/failed')
    const response = await callRoute(QueuesRoute, 'PUT', sent)
    expect(await response.text()).toBe('board')
    expect(fetch).toHaveBeenCalledWith(sent)
  })

  it("says so when the job queue isn't running", async () => {
    await createUser({ id: 'admin', isAdmin: true })
    signedInAs('admin')
    vi.mocked(jobBoard).mockResolvedValue(null)
    const response = await callRoute(QueuesRoute, 'GET', request())
    expect(response.status).toBe(503)
    expect(await response.text()).toMatch(/REDIS_URL/)
  })
})
