// The sites episodes are downloaded from. Downloads are throttled per platform
// (see download-throttle.server.ts), and a show can follow a channel on
// any platform in channelProviders.

export type Platform = 'youtube' | 'mixcloud' | 'soundcloud' | 'other'

export const platformNames: Record<Platform, string> = {
  youtube: 'YouTube',
  mixcloud: 'Mixcloud',
  soundcloud: 'SoundCloud',
  other: 'The site',
}

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

// The platforms a show can follow a channel on. To add one, add an entry
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
  {
    platform: 'soundcloud',
    label: 'SoundCloud',
    example: 'https://soundcloud.com/user',
    parseChannelUrl(url) {
      if (!onHost(url.hostname.toLowerCase(), 'soundcloud.com')) return null
      const [user, tab, ...rest] = url.pathname.split('/').filter(Boolean)
      // A user's page or their tracks tab; /<user>/<name> is a single track and
      // /<user>/sets/<name> a playlist.
      if (!user || rest.length || (tab && tab !== 'tracks')) return null
      // SoundCloud's own pages, not users.
      if (soundcloudPages.includes(user)) return null
      return `https://soundcloud.com/${user}/tracks`
    },
  },
]

const soundcloudPages = [
  'discover', 'stream', 'upload', 'you', 'search', 'charts', 'pages', 'settings',
  'messages', 'notifications', 'people', 'tags', 'feed', 'signin', 'mobile', 'terms-of-use',
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

// The platforms whose playlists admins can import whole (see
// createPlaylistShow in channels.server.ts). yt-dlp lists them all.
export const playlistPlatforms = 'YouTube, Mixcloud or SoundCloud'

// A playlist's platform and normalised URL, or null if the link isn't to one.
export function parsePlaylistUrl(url: string): { platform: Platform; url: string } | null {
  const parsed = parseUrl(url)
  if (!parsed) return null
  const host = parsed.hostname.toLowerCase()
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (onHost(host, 'youtube.com') || onHost(host, 'youtu.be')) {
    // /playlist?list=…, or a video played from a playlist (watch?v=…&list=…).
    const list = parsed.searchParams.get('list')
    // Mixes (RD…) are made up as they play and never end; Watch later and
    // Liked videos (WL, LL) are private.
    if (!list || !/^[\w-]+$/.test(list) || /^(RD|WL$|LL$)/.test(list)) return null
    return { platform: 'youtube', url: `https://www.youtube.com/playlist?list=${list}` }
  }
  if (onHost(host, 'mixcloud.com')) {
    const [user, tab, name, ...rest] = parts
    if (!user || tab !== 'playlists' || !name || rest.length) return null
    return { platform: 'mixcloud', url: `https://www.mixcloud.com/${user}/playlists/${name}/` }
  }
  if (onHost(host, 'soundcloud.com')) {
    const [user, tab, name, ...rest] = parts
    if (!user || tab !== 'sets' || !name || rest.length) return null
    return { platform: 'soundcloud', url: `https://soundcloud.com/${user}/sets/${name}` }
  }
  return null
}
