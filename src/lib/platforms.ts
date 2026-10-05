// The sites episodes are downloaded from. Downloads are throttled per platform
// (see download-throttle.server.ts), and a podcast can follow a channel on
// any platform in channelProviders.

export type Platform = 'youtube' | 'mixcloud' | 'soundcloud' | 'other'

const hosts: Record<Exclude<Platform, 'other'>, string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  mixcloud: ['mixcloud.com'],
  soundcloud: ['soundcloud.com'],
}

function parseUrl(url: string) {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
  } catch {
    return null
  }
}

// Matches the domain and its subdomains (www., m., music.…).
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

export function platformOf(url: string): Platform {
  const host = parseUrl(url)?.hostname.toLowerCase()
  if (!host) return 'other'
  for (const [platform, domains] of Object.entries(hosts)) {
    if (domains.some((domain) => onHost(host, domain))) return platform as Platform
  }
  return 'other'
}

export type ChannelProvider = {
  platform: Platform
  label: string
  // An example, for the form.
  example: string
  // The channel's list of uploads, as yt-dlp is given it, or null if the link
  // isn't to a channel on this platform.
  parseChannelUrl: (url: URL) => string | null
}

// The platforms a podcast can follow a channel on. To add one, add an entry
// that recognises its channel links; yt-dlp does the rest.
export const channelProviders: ChannelProvider[] = [
  {
    platform: 'youtube',
    label: 'YouTube',
    example: 'https://www.youtube.com/@channel',
    parseChannelUrl(url) {
      if (!onHost(url.hostname.toLowerCase(), 'youtube.com')) return null
      const [first, second] = url.pathname.split('/').filter(Boolean)
      if (!first) return null
      // /@handle, /channel/UC…, /c/name and /user/name, with or without a tab
      // after them. Always the videos tab, which leaves out Shorts and streams.
      const base = first.startsWith('@')
        ? first
        : ['channel', 'c', 'user'].includes(first) && second
          ? `${first}/${second}`
          : null
      return base && `https://www.youtube.com/${base}/videos`
    },
  },
  {
    platform: 'mixcloud',
    label: 'Mixcloud',
    example: 'https://www.mixcloud.com/user/',
    parseChannelUrl(url) {
      if (!onHost(url.hostname.toLowerCase(), 'mixcloud.com')) return null
      const [user, tab, ...rest] = url.pathname.split('/').filter(Boolean)
      // A user's page or their uploads tab; anything deeper is a single show
      // or a playlist.
      if (!user || rest.length || (tab && tab !== 'uploads')) return null
      // Mixcloud's own pages, not users.
      if (['discover', 'upload', 'settings', 'search', 'live', 'select', 'about'].includes(user)) return null
      return `https://www.mixcloud.com/${user}/uploads/`
    },
  },
]

// Which provider recognises the link, and the channel's normalised URL.
export function parseChannelUrl(url: string) {
  const parsed = parseUrl(url)
  if (!parsed) return null
  for (const provider of channelProviders) {
    const normalised = provider.parseChannelUrl(parsed)
    if (normalised) return { platform: provider.platform, url: normalised }
  }
  return null
}
