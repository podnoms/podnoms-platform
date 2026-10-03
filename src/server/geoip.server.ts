// Where listeners roughly are, from MaxMind's free GeoLite2 City database:
// country, region and city, never anything finer. The database is downloaded
// into MEDIA_DIR when a MaxMind account is configured, and refreshed weekly
// by the 'geoip-update' job (MaxMind updates it twice a week).
import '@tanstack/react-start/server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import maxmind, { type CityResponse, type Reader } from 'maxmind'
import { x as extract } from 'tar'
import { env } from '~/env'
import { logger, reportError } from '~/server/logger.server'
import { ensureGeoipDir, geoipDatabasePath } from '~/server/storage.server'

export type Location = { country: string | null; region: string | null; city: string | null }

const downloadUrl = 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz'

// Kept across dev server reloads, which re-run this module.
const state = globalThis as {
  podnomsGeoip?: {
    reader: Promise<Reader<CityResponse> | null> | null
    downloading: Promise<boolean> | null
    lastAttempt: number
  }
}
const geoip = (state.podnomsGeoip ??= { reader: null, downloading: null, lastAttempt: 0 })
// How long to wait before trying a missing database's download again.
const retryAfterMs = 60 * 60 * 1000

const configured = () => Boolean(env.MAXMIND_ACCOUNT_ID && env.MAXMIND_LICENSE_KEY)

function openReader() {
  geoip.reader ??= stat(geoipDatabasePath)
    .then(
      () => maxmind.open<CityResponse>(geoipDatabasePath),
      () => {
        // Not downloaded yet: fetch it for next time, and go without for now.
        if (configured() && Date.now() - geoip.lastAttempt > retryAfterMs) void updateGeoipDatabase()
        geoip.reader = null
        return null
      },
    )
    .catch((error: unknown) => {
      geoip.reader = null
      throw error
    })
  return geoip.reader
}

// The location of an IP address, or null if it's unknown or there's no database.
export async function lookupLocation(ip: string | null): Promise<Location | null> {
  if (!ip || !maxmind.validate(ip)) return null
  try {
    const found = (await openReader())?.get(ip)
    if (!found?.country && !found?.city) return null
    return {
      country: found.country?.iso_code ?? null,
      region: found.subdivisions?.[0]?.iso_code ?? null,
      city: found.city?.names.en ?? null,
    }
  } catch (error) {
    reportError(error, { msg: 'GeoIP lookup failed' })
    return null
  }
}

// Downloads the latest database, replacing the current one only once the new
// one is complete. Resolves to whether it did; without a MaxMind account it
// does nothing.
export function updateGeoipDatabase() {
  if (!configured()) return Promise.resolve(false)
  geoip.lastAttempt = Date.now()
  geoip.downloading ??= download()
    .then(() => {
      geoip.reader = null
      logger.info('GeoIP database updated')
      return true
    })
    .catch((error: unknown) => {
      reportError(error, { msg: 'Could not update the GeoIP database' })
      return false
    })
    .finally(() => {
      geoip.downloading = null
    })
  return geoip.downloading
}

async function download() {
  const dir = await ensureGeoipDir()
  const response = await fetch(downloadUrl, {
    headers: {
      authorization: `Basic ${Buffer.from(`${env.MAXMIND_ACCOUNT_ID}:${env.MAXMIND_LICENSE_KEY}`).toString('base64')}`,
    },
  })
  if (!response.ok || !response.body) throw new Error(`MaxMind answered ${response.status}`)

  // The archive holds GeoLite2-City_<date>/GeoLite2-City.mmdb, with a licence
  // and readme; only the database is wanted.
  const work = join(dir, `.download-${randomUUID()}`)
  try {
    await mkdir(work, { recursive: true })
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream),
      extract({ cwd: work, strip: 1, filter: (path) => path.endsWith('.mmdb') }),
    )
    await rename(join(work, 'GeoLite2-City.mmdb'), geoipDatabasePath)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
