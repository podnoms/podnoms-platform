// Reporting an image, which anyone can do (see reports.server.ts). Admins deal
// with reports through the admin functions.
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { reportSchema } from '~/lib/report-schema'
import { clientIp } from '~/server/activity.server'
import { getSession } from '~/server/auth.server'
import { createReport } from '~/server/reports.server'

export const reportImage = createServerFn({ method: 'POST' })
  .validator(reportSchema)
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await getSession(request)
    // Whether it was recorded makes no difference to the reporter, so they're
    // always thanked; not saying stops anyone probing for what's been reported.
    await createReport(
      { userId: session?.user?.id ?? null, ip: clientIp(request), userAgent: request.headers.get('user-agent') },
      data,
    )
  })
