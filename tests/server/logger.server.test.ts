import { describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/node', () => ({ init: vi.fn(), withScope: vi.fn(), captureException: vi.fn() }))

async function load(dsn?: string) {
  vi.resetModules()
  if (dsn) process.env.SENTRY_DSN = dsn
  else delete process.env.SENTRY_DSN
  const Sentry = await import('@sentry/node')
  vi.mocked(Sentry.init).mockClear()
  vi.mocked(Sentry.withScope).mockClear()
  const { logger, reportError } = await import('~/server/logger.server')
  return { Sentry, logger, reportError }
}

describe('reportError', () => {
  it('logs the error with its context', async () => {
    const { logger, reportError } = await load()
    const error = vi.spyOn(logger, 'error')
    const failure = new Error('ffmpeg exited with code 1')
    reportError(failure, { episodeId: 'e1', msg: 'Episode processing failed' })
    expect(error).toHaveBeenCalledWith({ err: failure, episodeId: 'e1' }, 'Episode processing failed')
  })

  it("uses the error's message when given no other", async () => {
    const { logger, reportError } = await load()
    const error = vi.spyOn(logger, 'error')
    reportError(new Error('Disk full'))
    expect(error).toHaveBeenCalledWith(expect.anything(), 'Disk full')
  })

  it("doesn't use Sentry without a DSN", async () => {
    const { Sentry, reportError } = await load()
    reportError(new Error('boom'))
    expect(Sentry.init).not.toHaveBeenCalled()
    expect(Sentry.withScope).not.toHaveBeenCalled()
  })

  it('sends the error to Sentry with a DSN, the user identified', async () => {
    const { Sentry, reportError } = await load('https://key@glitchtip.test/1')
    const scope = { setUser: vi.fn(), setExtras: vi.fn() }
    vi.mocked(Sentry.withScope).mockImplementation(((callback: (s: typeof scope) => void) => callback(scope)) as never)
    const failure = new Error('boom')
    reportError(failure, { userId: 'u1', serverFn: 'createEpisode' })

    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://key@glitchtip.test/1', tracesSampleRate: 0 }))
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'u1' })
    expect(scope.setExtras).toHaveBeenCalledWith({ serverFn: 'createEpisode' })
    expect(Sentry.captureException).toHaveBeenCalledWith(failure)
    delete process.env.SENTRY_DSN
  })
})
