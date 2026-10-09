// App-wide middleware: request logging, reporting of errors thrown by routes
// and server functions (see src/server/logger.server.ts), and keeping search
// engines out of what isn't a page.
import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware, createStart } from '@tanstack/react-start'
import { noindexPath } from '~/lib/robots'

// Served often enough that a line each would drown out everything else.
const quietPaths = [/^\/images\//, /^\/api\/episodes\/[^/]+\/audio/, /^\/assets\//, /^\/@/, /^\/node_modules\//, /\.\w+$/]

// Errors that are part of normal control flow, or the caller's fault.
const expected = (error: unknown) =>
  isRedirect(error) || isNotFound(error) || (error instanceof Error && error.name === 'ZodError')

const loggingMiddleware = createMiddleware().server(async ({ request, pathname, next, handlerType, serverFnMeta }) => {
  const { logger, reportError } = await import('~/server/logger.server')
  // Background jobs start with the first request; later calls do nothing.
  void import('~/server/jobs.server').then(({ startJobs }) => startJobs())
  const started = Date.now()
  const fields = {
    method: request.method,
    path: pathname,
    ...(handlerType === 'serverFn' && serverFnMeta && { serverFn: serverFnMeta.name }),
  }
  try {
    const result = await next()
    const { status } = result.response
    const line = { ...fields, status, durationMs: Date.now() - started }
    if (status >= 500) logger.error(line, 'Request failed')
    else if (quietPaths.some((path) => path.test(pathname))) logger.debug(line, 'Request')
    else logger.info(line, 'Request')
    return result
  } catch (error) {
    if (!expected(error)) reportError(error, { ...fields, durationMs: Date.now() - started, msg: 'Request failed' })
    throw error
  }
})

const noindexMiddleware = createMiddleware().server(async ({ pathname, next }) => {
  const result = await next()
  if (!noindexPath(pathname)) return result
  try {
    result.response.headers.set('X-Robots-Tag', 'noindex')
    return result
  } catch {
    // The headers of a response from fetch() can't be changed; copy them.
    const { response } = result
    const headers = new Headers(response.headers)
    headers.set('X-Robots-Tag', 'noindex')
    return { ...result, response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }) }
  }
})

const serverFnErrorMiddleware = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  try {
    return await next()
  } catch (error) {
    if (!expected(error)) {
      const { reportError } = await import('~/server/logger.server')
      reportError(error, { serverFn: serverFnMeta.name, file: serverFnMeta.filename })
    }
    throw error
  }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [loggingMiddleware, noindexMiddleware],
  functionMiddleware: [serverFnErrorMiddleware],
}))
