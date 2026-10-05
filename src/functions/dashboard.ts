import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { dashboardQuerySchema } from '~/lib/activity-schema'
import { getSession } from '~/server/auth.server'
import { getDashboard } from '~/server/dashboard.server'

// Counts and stats across all of the signed-in user's podcasts, for the home page.
export const fetchDashboard = createServerFn({ method: 'GET' })
  .validator(dashboardQuerySchema)
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    return getDashboard(session.user.id, data.days)
  })
