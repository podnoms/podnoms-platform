// Keeps yt-dlp up to date without a new image: YouTube changes often, and an
// old yt-dlp is refused sooner ("confirm you're not a bot"). The Docker image
// sets YTDLP_PIP to the pip of yt-dlp's own virtualenv, which the app's user
// owns; the entrypoint updates it on start, and the ytdlp-update job here
// every few hours. Without YTDLP_PIP (development) it does nothing.
import '@tanstack/react-start/server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { env } from '~/env'
import { whileNoDownloads } from '~/server/download-throttle.server'
import { logger } from '~/server/logger.server'

const run = promisify(execFile)

// Overridable in tests.
export const ytDlpUpdateConfig = {
  pip: env.YTDLP_PIP ?? null,
}

export async function ytDlpVersion() {
  const { stdout } = await run(env.YTDLP_PATH, ['--version'])
  return stdout.trim()
}

// As in the Dockerfile and docker/entrypoint.sh. The bgutil plugin is kept in
// step with its sidecar, which Watchtower keeps on its latest image.
const packages = ['yt-dlp[default]', 'bgutil-ytdlp-pot-provider']

export type YtDlpUpdate =
  | { skipped: 'not configured' | 'downloads running' }
  | { from: string; to: string; updated: boolean }

export async function updateYtDlp(): Promise<YtDlpUpdate> {
  const { pip } = ytDlpUpdateConfig
  if (!pip) return { skipped: 'not configured' }
  // Replacing yt-dlp's files under a running yt-dlp could break it, so no
  // download starts until pip is done.
  const result = await whileNoDownloads(async () => {
    const from = await ytDlpVersion()
    await run(pip, ['install', '--no-cache-dir', '--quiet', '--disable-pip-version-check', '--upgrade', ...packages], {
      timeout: 5 * 60_000,
    })
    const to = await ytDlpVersion()
    return { from, to, updated: from !== to }
  })
  if (!result) return { skipped: 'downloads running' }
  if (result.updated) logger.info(result, 'Updated yt-dlp')
  return result
}
