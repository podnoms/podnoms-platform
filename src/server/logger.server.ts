// Structured logs: one JSON object per line on stdout in production, for a
// collector such as Grafana Alloy to ship to Loki; readable lines in
// development. Silent under the tests.
import '@tanstack/react-start/server-only'
import pino from 'pino'
import { env } from '~/env'
import { appVersion } from '~/lib/app-version'
import { captureException } from '~/server/sentry.server'

// In process rather than as a pino transport, whose worker thread can't find
// pino-pretty under Vite's dev server.
const pretty =
  process.env.NODE_ENV !== 'production' && !process.env.VITEST
    ? (await import('pino-pretty')).default({ ignore: 'app,version' })
    : undefined

export const logger = pino(
  {
    level: process.env.VITEST ? 'silent' : env.LOG_LEVEL,
    base: { app: 'podnoms', version: appVersion },
    // Levels by name rather than number, so they can be filtered on as is.
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pretty,
)

// Something went wrong that someone should look at: logged as an error and
// sent to the error tracker, if there is one.
export function reportError(error: unknown, context: Record<string, unknown> & { msg?: string } = {}) {
  const { msg = error instanceof Error ? error.message : String(error), ...fields } = context
  logger.error({ err: error, ...fields }, msg)
  captureException(error, fields)
}

const handlers = globalThis as { podnomsProcessHandlers?: true }
// Once only, as dev server reloads re-run this module. A monitor reports the
// error (unhandled rejections included) without stopping the process from
// exiting as it would otherwise.
if (!handlers.podnomsProcessHandlers) {
  handlers.podnomsProcessHandlers = true
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    reportError(error, { msg: origin === 'unhandledRejection' ? 'Unhandled promise rejection' : 'Uncaught exception' }),
  )
}
