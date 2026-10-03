// Names the app or browser, OS and kind of device behind a user agent, for
// podcast stats. General-purpose parsers don't know podcast apps, which are
// most of what fetches a feed's audio, so they're matched here first (after
// the list at github.com/opawg/user-agents). Anything unknown is left null.
import '@tanstack/react-start/server-only'
import { isbot } from 'isbot'

export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'speaker' | 'watch' | 'tv'

export type UserAgentInfo = { client: string | null; os: string | null; device: DeviceKind | null }

// Checked in order: the first match names the client.
const podcastApps: [RegExp, string][] = [
  [/^Overcast\//, 'Overcast'],
  [/Pocket ?Casts/i, 'Pocket Casts'],
  [/^Castro /, 'Castro'],
  [/^Spotify\/|Spotify-Lite/, 'Spotify'],
  [/^PodcastAddict\//, 'Podcast Addict'],
  [/^AntennaPod\//, 'AntennaPod'],
  [/^Podverse\//, 'Podverse'],
  [/^CastBox\/|^Castbox/i, 'Castbox'],
  [/^Player FM|^PlayerFM/i, 'Player FM'],
  [/^iCatcher!/, 'iCatcher!'],
  [/^Downcast\//, 'Downcast'],
  [/^Podcast Republic/, 'Podcast Republic'],
  [/^Podbean\//, 'Podbean'],
  [/^Fountain\//, 'Fountain'],
  [/^Podcast Guru/, 'Podcast Guru'],
  [/^Deezer\//, 'Deezer'],
  [/^Audible/, 'Audible'],
  [/^(Amazon Music|AmazonMusic)/, 'Amazon Music'],
  [/^YouTubeMusic|com\.google\.android\.apps\.youtube\.music/, 'YouTube Music'],
  [/^Pandora/, 'Pandora'],
  [/^gPodder\//, 'gPodder'],
  [/^Juice\//, 'Juice'],
  [/^Alexa(MediaPlayer| Mobile)?\/|^Echo\//, 'Alexa'],
  [/^Sonos/, 'Sonos'],
  [/^Podcasts\/|^Balados\/|^Podcasti\/|^iTunes\/|watchOS\/.*atc\//, 'Apple Podcasts'],
  [/AppleCoreMedia\//, 'Apple (system player)'],
  [/^VLC\/|LibVLC/, 'VLC'],
  [/^Lavf\//, 'FFmpeg'],
]

// Browsers, after podcast apps (which often borrow their user agents).
const browsers: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
]

const systems: [RegExp, string][] = [
  [/watchOS|Watch OS|Apple Watch/i, 'watchOS'],
  [/iPhone|iPad|iPod|iOS|CFNetwork/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh|macOS/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

export function describeUserAgent(userAgent: string | null): UserAgentInfo {
  if (!userAgent) return { client: null, os: null, device: null }
  const client = firstMatch(podcastApps, userAgent) ?? firstMatch(browsers, userAgent)
  const os = firstMatch(systems, userAgent)
  return { client, os, device: deviceKind(userAgent, client, os) }
}

// Crawlers and link-preview fetchers, whose requests aren't listeners.
// Podcast apps often put a URL in their user agents, which looks like a
// crawler's, so known ones are let through first.
export function isBot(userAgent: string | null) {
  if (!userAgent) return true
  return !firstMatch(podcastApps, userAgent) && isbot(userAgent)
}

function firstMatch(patterns: [RegExp, string][], userAgent: string) {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
}

function deviceKind(userAgent: string, client: string | null, os: string | null): DeviceKind | null {
  if (os === 'watchOS') return 'watch'
  if (client === 'Alexa' || client === 'Sonos') return 'speaker'
  if (/SmartTV|AppleTV|tvOS|Roku|CrKey/i.test(userAgent)) return 'tv'
  if (/iPad|Tablet/i.test(userAgent) || (os === 'Android' && !/Mobile/.test(userAgent) && /Mozilla/.test(userAgent))) {
    return 'tablet'
  }
  if (os === 'iOS' || os === 'Android') return 'phone'
  if (os === 'macOS' || os === 'Windows' || os === 'Linux' || os === 'ChromeOS') return 'desktop'
  return null
}
