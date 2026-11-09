import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '~/env'
import { resetThrottle, withDownloadSlot } from '~/server/download-throttle.server'
import { updateYtDlp, ytDlpUpdateConfig } from '~/server/ytdlp-update.server'

const fakePip = resolve(import.meta.dirname, '../fixtures/fake-pip.mjs')
const versionFile = () => join(env.MEDIA_DIR, 'yt-dlp-version')
const pipLog = () => join(env.MEDIA_DIR, 'pip-args')

beforeEach(async () => {
  resetThrottle()
  ytDlpUpdateConfig.pip = fakePip
  await writeFile(versionFile(), '2026.10.21')
  Object.assign(process.env, { FAKE_PIP_VERSION_FILE: versionFile(), FAKE_PIP_LOG: pipLog() })
})
afterEach(() => {
  ytDlpUpdateConfig.pip = null
  for (const name of ['FAKE_PIP_VERSION_FILE', 'FAKE_PIP_LOG', 'FAKE_PIP_NEW_VERSION', 'FAKE_PIP_FAIL']) delete process.env[name]
})

describe('updateYtDlp', () => {
  it('does nothing without YTDLP_PIP', async () => {
    ytDlpUpdateConfig.pip = null
    expect(await updateYtDlp()).toEqual({ skipped: 'not configured' })
  })

  it('upgrades yt-dlp with its pip and reports the versions', async () => {
    process.env.FAKE_PIP_NEW_VERSION = '2026.11.08'
    expect(await updateYtDlp()).toEqual({ from: '2026.10.21', to: '2026.11.08', updated: true })
    expect(await readFile(pipLog(), 'utf8')).toContain('install --no-cache-dir --quiet --disable-pip-version-check --upgrade yt-dlp[default] bgutil-ytdlp-pot-provider')
  })

  it('says so when it was already the latest', async () => {
    expect(await updateYtDlp()).toEqual({ from: '2026.10.21', to: '2026.10.21', updated: false })
  })

  it("waits for another time while a download is running, so yt-dlp isn't replaced under it", async () => {
    let finish = () => {}
    const download = withDownloadSlot('youtube', { key: 'show' }, () => new Promise<void>((done) => (finish = done)))
    await new Promise((r) => setTimeout(r, 10))
    expect(await updateYtDlp()).toEqual({ skipped: 'downloads running' })
    finish()
    await download
  })

  it('fails, for the job to retry, when pip does', async () => {
    process.env.FAKE_PIP_FAIL = '1'
    await expect(updateYtDlp()).rejects.toThrow()
  })
})
