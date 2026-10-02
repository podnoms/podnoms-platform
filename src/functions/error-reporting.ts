import { createServerFn } from '@tanstack/react-start'
import { env } from '~/env'

// Where the browser should report its errors: the server's own DSN, which is
// safe to expose. Read at runtime so one image serves any deployment.
export const fetchErrorReportingDsn = createServerFn({ method: 'GET' }).handler(() => env.SENTRY_DSN ?? null)
