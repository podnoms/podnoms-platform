import { describe, expect, it } from 'vitest'
import { noindexPath } from '~/lib/robots'

describe('noindexPath', () => {
  it.each(['/api/episodes/1/audio', '/_serverFn/abc', '/admin/queues', '/admin/queues/api/queues'])('is true for %s', (path) => {
    expect(noindexPath(path)).toBe(true)
  })

  it.each(['/', '/podcasts/show', '/admin', '/apiary', '/feed/show'])('is false for %s', (path) => {
    expect(noindexPath(path)).toBe(false)
  })
})
