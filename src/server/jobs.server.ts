// Background jobs, queued in Redis with BullMQ and run by a worker in this
// server process. Scheduled jobs are registered here; to add one, add its
// handler to `jobs` and, if it repeats, a schedule to `schedules`.
//
// Started on the first request (see src/start.ts). Without REDIS_URL, jobs
// don't run and a warning is logged instead.
import '@tanstack/react-start/server-only'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { env } from '~/env'
import { updateGeoipDatabase } from '~/server/geoip.server'
import { cleanUpMedia } from '~/server/media-cleanup.server'
import { logger, reportError } from '~/server/logger.server'

const queueName = 'jobs'
// Keys are prefixed with the app's name, so the Redis can be shared.
const prefix = 'podnoms'

const jobs = {
  'media-cleanup': () => cleanUpMedia(),
  // Does nothing without a MaxMind account.
  'geoip-update': () => updateGeoipDatabase(),
} satisfies Record<string, () => Promise<unknown>>

export type JobName = keyof typeof jobs

// Cron patterns, in the server's time zone.
const schedules: { name: JobName; pattern: string }[] = [
  { name: 'media-cleanup', pattern: '30 3 * * *' },
  // MaxMind publishes updates on Tuesdays and Fridays.
  { name: 'geoip-update', pattern: '0 4 * * 3' },
]

type Running = { queue: Queue; worker: Worker }
// Kept across dev server reloads, which re-run this module.
const state = globalThis as { podnomsJobs?: Promise<Running | null> }

export function startJobs() {
  state.podnomsJobs ??= start().catch((error: unknown) => {
    reportError(error, { msg: 'Could not start the job queue' })
    return null
  })
  return state.podnomsJobs
}

async function start(): Promise<Running | null> {
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL is not set; scheduled jobs (such as the media clean-up) will not run')
    return null
  }
  // Workers block on Redis, so commands must wait out reconnections rather
  // than fail after a few retries.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = new Queue(queueName, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      // Enough history to see what happened, without growing forever.
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  })
  const worker = new Worker(
    queueName,
    async (job) => {
      const run = jobs[job.name as JobName]
      if (!run) throw new Error(`No handler for the job ${job.name}`)
      return run()
    },
    { connection, prefix, concurrency: 1 },
  )

  worker.on('active', (job) => logger.info({ job: job.name, jobId: job.id }, 'Job started'))
  worker.on('completed', (job, result: unknown) =>
    logger.info({ job: job.name, jobId: job.id, result, durationMs: Date.now() - (job.processedOn ?? Date.now()) }, 'Job finished'),
  )
  worker.on('failed', (job, error) =>
    reportError(error, { job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, msg: 'Job failed' }),
  )
  // Connection problems; BullMQ keeps retrying.
  worker.on('error', (error) => logger.warn({ err: error }, 'Job worker error'))
  queue.on('error', (error) => logger.warn({ err: error }, 'Job queue error'))

  for (const { name, pattern } of schedules) {
    await queue.upsertJobScheduler(name, { pattern }, { name })
  }
  logger.info({ schedules }, 'Job queue started')
  return { queue, worker }
}

// Queues a job to run now, e.g. from an admin page.
export async function runJob(name: JobName) {
  const running = await startJobs()
  if (!running) throw new Error('The job queue is not running (is REDIS_URL set?)')
  return running.queue.add(name, {})
}
