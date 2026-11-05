// Episodes' HLS streams: their audio in a few bitrates, cut into short
// segments, which the site's players and the mobile app play, picking a
// bitrate and switching as the connection changes. Feeds keep the MP3, as
// podcast apps don't play HLS from an enclosure.
//
// Each stream is built from the episode's master (its source audio as it
// came, see media.server.ts) or, for episodes made before masters were kept,
// its MP3, into MEDIA_DIR/hls/<episode id>/<version>/. Every build gets a new
// version, as does an episode leaving public view, so every URL under one is
// immutable: nothing in front of the site (a CDN, a caching proxy, or none)
// ever needs purging, and standard Cache-Control is all it needs to know.
//
// Players start at the entry playlist, /api/episodes/<id>/hls/master.m3u8,
// which applies the same rules as the audio endpoint. It points at the
// version's own playlists, which name their segments relatively. Those of
// public episodes (published, neither it nor its show private) are open to
// anyone and cacheable by anyone. Everything else's are under a signed,
// expiring path (…/<version>/s/<signature>/…), which relative URLs carry on to
// every segment, as players can't be relied on to send cookies or tokens.
import '@tanstack/react-start/server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, shows } from '~/server/db/schema'
import { logger, reportError } from '~/server/logger.server'
import { packageHls, probeStream } from '~/server/media.server'
import { signingKey } from '~/server/secrets.server'
import { episodeAudioPath, episodeHlsDir, episodeHlsVersionDir, episodeMasterPath } from '~/server/storage.server'

// How long a signed path works for. A player still going after that falls
// back to the MP3 (see src/lib/stream.ts).
export const hlsSignatureLifetimeMs = 24 * 60 * 60 * 1000

// Files a version may hold, by their path inside it.
export const hlsFilePattern = /^\d+k\/(index\.m3u8|init_\d+\.mp4|seg-\d{5,}\.m4s)$/

export function newHlsVersion() {
  return randomBytes(6).toString('base64url')
}

function sign(episodeId: string, version: string, expires: number) {
  return createHmac('sha256', signingKey('podnoms hls signature')).update(`${episodeId}/${version}/${expires}`).digest('base64url')
}

// "<expires, in Unix seconds>.<HMAC>"
export function hlsSignature(episodeId: string, version: string, now = Date.now()) {
  const expires = Math.floor((now + hlsSignatureLifetimeMs) / 1000)
  return `${expires}.${sign(episodeId, version, expires)}`
}

export function verifyHlsSignature(episodeId: string, version: string, signature: string, now = Date.now()) {
  const match = /^(\d{1,12})\.([\w-]{43})$/.exec(signature)
  if (!match) return false
  const expires = Number(match[1])
  if (expires * 1000 < now) return false
  const expected = Buffer.from(sign(episodeId, version, expires))
  const given = Buffer.from(match[2]!)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Where a version's files are served from, signed unless the episode is public.
function versionPath(episodeId: string, version: string, signed: boolean) {
  const base = `/api/episodes/${episodeId}/hls/${version}`
  return signed ? `${base}/s/${hlsSignature(episodeId, version)}` : base
}

export type HlsAccess = {
  hlsVersion: string | null
  // Published, and neither it nor its show private: anyone may have it.
  public: boolean
}

// The entry playlist for someone the audio endpoint's rules let have the
// episode (see getEpisodeAudio): the version's master playlist, with its
// playlists' paths made absolute (and signed unless the episode is public).
// Null when there's no stream yet, which also asks for one to be built.
export async function entryPlaylist(episodeId: string, access: HlsAccess) {
  const version = access.hlsVersion
  const text = version ? await readFile(join(episodeHlsVersionDir(episodeId, version), 'master.m3u8'), 'utf8').catch(() => null) : null
  if (!version || text === null) {
    queueHlsBuild(episodeId)
    return null
  }
  const base = versionPath(episodeId, version, !access.public)
  return text
    .split('\n')
    .map((line) => (line && !line.startsWith('#') ? `${base}/${line}` : line))
    .join('\n')
}

// The file to serve for a request under a version, or null. `signature` is
// the path's, if it has one: a valid one opens any version still on disk (so
// players mid-episode finish after a rebuild); without one, only the current
// version of a public episode.
export async function hlsFilePath(episodeId: string, version: string, signature: string | null, file: string) {
  if (!hlsFilePattern.test(file) || !/^[\w-]+$/.test(version)) return null
  if (signature !== null) {
    if (!verifyHlsSignature(episodeId, version, signature)) return null
  } else {
    const [episode] = await db
      .select({ status: episodes.status, hlsVersion: episodes.hlsVersion, private: episodes.private, showPrivate: shows.private })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(episodes.id, episodeId))
      .limit(1)
    if (!episode || episode.status !== 'ready' || episode.private || episode.showPrivate || episode.hlsVersion !== version) return null
  }
  const path = join(episodeHlsVersionDir(episodeId, version), file)
  return (await stat(path).catch(() => null))?.isFile() ? path : null
}

// Builds a new version of the episode's stream and makes it current. Returns
// the version, or null if the episode isn't ready or its audio changed while
// building (when it's queued again).
export async function buildHls(episodeId: string) {
  const [episode] = await db
    .select({ status: episodes.status, audioUrl: episodes.audioUrl })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
  if (episode?.status !== 'ready') return null
  const master = episodeMasterPath(episodeId)
  const hasMaster = Boolean(await stat(master).catch(() => null))
  const source = hasMaster ? master : episodeAudioPath(episodeId)
  const info = await probeStream(source)
  if (!info) throw new Error(`No audio to stream in ${source}`)
  const version = newHlsVersion()
  const dir = episodeHlsVersionDir(episodeId, version)
  await mkdir(dir, { recursive: true })
  try {
    await packageHls(source, dir, info, () => {})
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  // Replaced meanwhile: this was made from the old audio.
  const [now] = await db
    .select({ audioUrl: episodes.audioUrl, hlsVersion: episodes.hlsVersion })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
  if (now?.audioUrl !== episode.audioUrl) {
    await rm(dir, { recursive: true, force: true })
    if (now) queueHlsBuild(episodeId)
    return null
  }
  await db
    .update(episodes)
    .set({
      hlsVersion: version,
      ...(hasMaster && { masterCodec: info.codec, masterBitrate: info.bitrate, masterChannels: info.channels }),
    })
    .where(eq(episodes.id, episodeId))
  // The old version is left for players part way through it, and the media
  // clean-up removes it a day after it's dated (see media-cleanup.server.ts),
  // so it's dated now.
  if (now.hlsVersion) {
    const old = episodeHlsVersionDir(episodeId, now.hlsVersion)
    const time = new Date()
    await utimes(old, time, time).catch(() => {})
  }
  return version
}

// Builds run one at a time, in the background: new and replaced audio, and
// episodes someone has just tried to stream, before the backfill.
const waiting = { soon: [] as string[], later: [] as string[] }
const queued = new Set<string>()
let draining: Promise<void> | null = null

export function queueHlsBuild(episodeId: string, priority: 'soon' | 'later' = 'soon') {
  if (queued.has(episodeId)) {
    // Someone wants it now: move it up.
    const later = waiting.later.indexOf(episodeId)
    if (priority === 'soon' && later !== -1) waiting.soon.push(...waiting.later.splice(later, 1))
    return
  }
  queued.add(episodeId)
  waiting[priority].push(episodeId)
  draining ??= drain().finally(() => {
    draining = null
  })
}

async function drain() {
  for (let id = waiting.soon.shift() ?? waiting.later.shift(); id; id = waiting.soon.shift() ?? waiting.later.shift()) {
    const started = Date.now()
    try {
      const version = await buildHls(id)
      if (version) logger.info({ episodeId: id, version, durationMs: Date.now() - started }, 'Built the episode’s HLS stream')
    } catch (error) {
      // The episode still plays, from its MP3; the next backfill tries again.
      reportError(error, { episodeId: id, msg: 'Could not build the episode’s HLS stream' })
    } finally {
      queued.delete(id)
    }
  }
}

// Resolves once every queued build has finished (for tests).
export async function hlsBuildsSettled() {
  while (draining) await draining
}

// Queues streams for ready episodes without one, newest first, behind
// anything else. Runs once, in the background, after the server starts.
let backfilled = false
export async function backfillHls() {
  if (backfilled) return
  backfilled = true
  const missing = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.status, 'ready'), isNull(episodes.hlsVersion)))
    .orderBy(desc(episodes.createdAt))
  for (const { id } of missing) queueHlsBuild(id, 'later')
  if (missing.length) logger.info({ episodes: missing.length }, 'Queued HLS streams for episodes without one')
}

// Gives the episodes' streams new versions (moving their folders), for when
// they leave public view: the public URLs then stop working here at once, and
// fall out of shared caches within their s-maxage, with nothing to purge.
export async function moveHlsVersions(episodeIds: string[]) {
  if (!episodeIds.length) return
  const rows = await db.select({ id: episodes.id, hlsVersion: episodes.hlsVersion }).from(episodes).where(inArray(episodes.id, episodeIds))
  for (const { id, hlsVersion } of rows) {
    if (!hlsVersion) continue
    const version = newHlsVersion()
    const moved = await rename(episodeHlsVersionDir(id, hlsVersion), episodeHlsVersionDir(id, version)).then(
      () => true,
      () => false,
    )
    await db.update(episodes).set({ hlsVersion: moved ? version : null }).where(eq(episodes.id, id))
    if (!moved) queueHlsBuild(id)
  }
}

export async function deleteHls(episodeId: string) {
  await rm(episodeHlsDir(episodeId), { recursive: true, force: true })
}
