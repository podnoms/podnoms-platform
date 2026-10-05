// Lists a channel's newest uploads, in as few requests to the platform as it
// allows. Most platforms are listed by yt-dlp, which fetches no more pages
// than it needs. Mixcloud is not: yt-dlp pages through every upload a user
// has ever made (hundreds of requests for a big account) before giving any,
// so Mixcloud's own API is asked for just the newest instead.
//
// Calls should be made inside a download slot (see download-throttle.server.ts).
import '@tanstack/react-start/server-only'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Platform } from '~/lib/platforms'
import { RateLimitedError } from '~/server/download-throttle.server'
import { runYtDlpLines } from '~/server/ytdlp.server'

export type ChannelEntry = {
  // "<platform>:<the platform's id for the upload>"
  key: string
  url: string
  title: string | null
  durationSeconds: number | null
  // Streams on now or yet to come, which have no recording to download.
  live: boolean
}

export type ChannelListing = {
  title: string | null
  description: string | null
  thumbnail: string | null
  // Newest first.
  entries: ChannelEntry[]
}

// `details` asks for the channel's title, description and artwork too, where
// they cost another request; they're only needed the first time.
export async function listChannel(
  platform: Platform,
  url: string,
  limit: number,
  { details = true } = {},
): Promise<ChannelListing> {
  return platform === 'mixcloud' ? listMixcloud(url, limit, details) : listWithYtDlp(platform, url, limit)
}

type YtDlpEntry = { id?: string; url?: string; webpage_url?: string; title?: string; duration?: number; live_status?: string }
type YtDlpPlaylist = {
  title?: string
  description?: string
  thumbnails?: { url?: string; id?: string; width?: number; height?: number }[]
}

async function listWithYtDlp(platform: Platform, url: string, limit: number): Promise<ChannelListing> {
  const entries: ChannelEntry[] = []
  let playlist: YtDlpPlaylist | undefined
  const args = [
    '--flat-playlist',
    // Stops fetching pages once it has enough, rather than listing them all first.
    '--lazy-playlist',
    '--playlist-end',
    String(limit),
    '--print',
    'ENTRY %(.{id,url,webpage_url,title,duration,live_status})j',
    '--print',
    'playlist:PLAYLIST %(.{title,description,thumbnails})j',
    url,
  ]
  await runYtDlpLines(args, (line) => {
    if (line.startsWith('PLAYLIST ')) playlist = JSON.parse(line.slice(9)) as YtDlpPlaylist
    if (!line.startsWith('ENTRY ')) return
    const entry = JSON.parse(line.slice(6)) as YtDlpEntry
    const entryUrl = entry.webpage_url ?? entry.url
    if (!entry.id || !entryUrl) return
    entries.push({
      key: `${platform}:${entry.id}`,
      url: entryUrl,
      title: entry.title?.trim() || null,
      durationSeconds: entry.duration ?? null,
      live: entry.live_status === 'is_live' || entry.live_status === 'is_upcoming',
    })
  })
  if (!playlist) throw new Error("yt-dlp didn't list the channel")
  const thumbnails = (playlist.thumbnails ?? []).filter((t) => t.url)
  // YouTube lists banners too; the avatar (the square one) is the channel's artwork.
  const thumbnail =
    thumbnails.find((t) => t.id === 'avatar_uncropped') ??
    thumbnails.filter((t) => t.width && t.width === t.height).at(-1) ??
    thumbnails.at(-1)
  return {
    // YouTube names the tab: "Someone - Videos".
    title: playlist.title?.replace(/ - (Videos|Uploads)$/, '').trim() || null,
    description: playlist.description?.trim() || null,
    thumbnail: thumbnail?.url ?? null,
    entries,
  }
}

// Overridable in tests. Requests are spaced out, as yt-dlp's are.
export const mixcloudApi = { base: 'https://api.mixcloud.com', pauseMs: 1000 }

type MixcloudPictures = Record<string, string | undefined>
type MixcloudUser = { name?: string; biog?: string; pictures?: MixcloudPictures }
type MixcloudCloudcast = { key?: string; url?: string; name?: string; audio_length?: number }

async function mixcloudGet<T>(path: string): Promise<T> {
  const response = await fetch(`${mixcloudApi.base}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'podnoms (+https://podnoms.com)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 429) throw new RateLimitedError('Mixcloud: too many requests')
  if (response.status === 404) throw new Error("Couldn't find that Mixcloud user")
  if (!response.ok) throw new Error(`Mixcloud answered ${response.status} ${response.statusText}`.trim())
  return (await response.json()) as T
}

async function listMixcloud(url: string, limit: number, details: boolean): Promise<ChannelListing> {
  // Channel URLs are normalised to https://www.mixcloud.com/<user>/uploads/.
  const user = new URL(url).pathname.split('/').filter(Boolean)[0]
  if (!user) throw new Error("That isn't a Mixcloud user's page")
  const path = `/${encodeURIComponent(user)}/`
  const uploads = await mixcloudGet<{ data?: MixcloudCloudcast[] }>(`${path}cloudcasts/?limit=${limit}`)
  let profile: MixcloudUser = {}
  if (details) {
    await sleep(mixcloudApi.pauseMs)
    profile = await mixcloudGet<MixcloudUser>(path)
  }
  const pictures = profile.pictures ?? {}
  return {
    title: profile.name?.trim() || null,
    description: profile.biog?.trim() || null,
    thumbnail: pictures['640wx640h'] ?? pictures.extra_large ?? pictures.large ?? null,
    entries: (uploads.data ?? []).slice(0, limit).flatMap((cloudcast) =>
      cloudcast.key && cloudcast.url
        ? [
            {
              key: `mixcloud:${cloudcast.key}`,
              url: cloudcast.url,
              title: cloudcast.name?.trim() || null,
              durationSeconds: cloudcast.audio_length ?? null,
              live: false,
            },
          ]
        : [],
    ),
  }
}
