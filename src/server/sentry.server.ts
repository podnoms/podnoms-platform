// Error reports to a Sentry-compatible service (e.g. a self-hosted GlitchTip),
// which groups them into issues. Off unless SENTRY_DSN is set.
import '@tanstack/react-start/server-only'
import * as Sentry from '@sentry/node'
import { env } from '~/env'
import { appVersion } from '~/lib/app-version'

export const sentryEnabled = Boolean(env.SENTRY_DSN)

if (sentryEnabled) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: `podnoms@${appVersion}`,
    // Errors only: GlitchTip has little use for performance traces.
    tracesSampleRate: 0,
    // The process handlers in logger.server.ts report these instead.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
  })
}

export function captureException(error: unknown, context: Record<string, unknown>) {
  if (!sentryEnabled) return
  Sentry.withScope((scope) => {
    const { userId, ...extra } = context
    if (typeof userId === 'string') scope.setUser({ id: userId })
    scope.setExtras(extra)
    Sentry.captureException(error)
  })
}
