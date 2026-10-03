import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Loads the module afresh with the given environment, as src/env.ts reads it once.
async function load(account?: { id: string; key: string }) {
  vi.resetModules()
  delete (globalThis as { podnomsGeoip?: unknown }).podnomsGeoip
  if (account) {
    vi.stubEnv('MAXMIND_ACCOUNT_ID', account.id)
    vi.stubEnv('MAXMIND_LICENSE_KEY', account.key)
  }
  return {
    ...(await import('~/server/geoip.server')),
    ...(await import('~/server/storage.server')),
  }
}

// A GeoLite2 download as MaxMind packs it: a dated folder holding the
// database, its licence and a readme.
async function archive(database: string) {
  const dir = await mkdtemp(join(tmpdir(), 'geoip-'))
  await mkdir(join(dir, 'GeoLite2-City_20261003'))
  await writeFile(join(dir, 'GeoLite2-City_20261003/GeoLite2-City.mmdb'), database)
  await writeFile(join(dir, 'GeoLite2-City_20261003/LICENSE.txt'), 'licence')
  const file = join(dir, 'download.tar.gz')
  await create({ gzip: true, cwd: dir, file }, ['GeoLite2-City_20261003'])
  return readFile(file)
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllEnvs())

describe('without a MaxMind account', () => {
  it('has no locations, and downloads nothing', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { lookupLocation, updateGeoipDatabase } = await load()
    expect(await lookupLocation('203.0.113.7')).toBeNull()
    expect(await updateGeoipDatabase()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('with a MaxMind account', () => {
  it('downloads the database, keeping only the database itself', async () => {
    const body = await archive('the database')
    const fetch = vi.fn(async () => new Response(body))
    vi.stubGlobal('fetch', fetch)
    const { updateGeoipDatabase, geoipDatabasePath } = await load({ id: '123', key: 'secret' })

    expect(await updateGeoipDatabase()).toBe(true)
    expect(await readFile(geoipDatabasePath, 'utf8')).toBe('the database')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('GeoLite2-City')
    expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${Buffer.from('123:secret').toString('base64')}`)
  })

  it('keeps the current database when a download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    const { updateGeoipDatabase, geoipDatabasePath, ensureGeoipDir } = await load({ id: '123', key: 'wrong' })
    await ensureGeoipDir()
    await writeFile(geoipDatabasePath, 'the old database')

    expect(await updateGeoipDatabase()).toBe(false)
    expect(await readFile(geoipDatabasePath, 'utf8')).toBe('the old database')
  })

  it('fetches a missing database when asked for a location, going without meanwhile', async () => {
    const body = await archive('the database')
    const fetch = vi.fn(async () => new Response(body))
    vi.stubGlobal('fetch', fetch)
    const { lookupLocation, geoipDatabasePath } = await load({ id: '123', key: 'secret' })
    await rm(geoipDatabasePath, { force: true })

    expect(await lookupLocation('203.0.113.7')).toBeNull()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })

  it("doesn't look up addresses that aren't addresses", async () => {
    const { lookupLocation } = await load({ id: '123', key: 'secret' })
    expect(await lookupLocation('not an ip')).toBeNull()
    expect(await lookupLocation(null)).toBeNull()
  })
})
