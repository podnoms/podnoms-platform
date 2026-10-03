import { describe, expect, it, vi } from 'vitest'

describe('startJobs', () => {
  it("doesn't run jobs without REDIS_URL, and says so", async () => {
    vi.resetModules()
    delete (globalThis as { podnomsJobs?: unknown }).podnomsJobs
    const { logger } = await import('~/server/logger.server')
    const warn = vi.spyOn(logger, 'warn')
    const { runJob, startJobs } = await import('~/server/jobs.server')

    expect(await startJobs()).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL is not set'))
    await expect(runJob('media-cleanup')).rejects.toThrow(/REDIS_URL/)
  })
})
