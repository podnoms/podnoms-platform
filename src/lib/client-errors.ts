// Reports browser errors to a Sentry-compatible service (e.g. a self-hosted
// GlitchTip) when the server has SENTRY_DSN set. The SDK is loaded separately,
// so it costs nothing when this is off.
import { appVersion } from '~/lib/app-version'

let sentry: Promise<typeof import('@sentry/react')> | null = null

export function startClientErrorReporting(dsn: string | null) {
  if (sentry || !dsn || typeof window === 'undefined') return
  sentry = import('@sentry/react').then((Sentry) => {
    Sentry.init({ dsn, environment: import.meta.env.MODE, release: `podnoms@${appVersion}`, tracesSampleRate: 0 })
    return Sentry
  })
}

// For errors caught by an error boundary, which the SDK doesn't see otherwise.
export function reportClientError(error: unknown) {
  void sentry?.then((Sentry) => Sentry.captureException(error))
}
