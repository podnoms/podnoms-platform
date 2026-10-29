// What the mobile app's API (src/routes/api/mobile/*) sends back: episodes and
// podcasts with full URLs, as the app isn't on this site, and descriptions as
// plain text, as it doesn't render HTML.
import '@tanstack/react-start/server-only'
import { cssColourToHslTriplet } from '~/lib/colour'
import { htmlToText } from '~/lib/rich-text'
import type { ModeStyles } from '~/lib/theme-schema'
import { getEpisodeProgress } from '~/server/episode-processor.server'
import type { listEpisodes } from '~/server/episodes.server'
import { siteUrl } from '~/server/extension-api.server'
import type { listContinueListening } from '~/server/library.server'
import { getSiteSettings } from '~/server/site-settings.server'

// The app's web build (for development) calls the API from another origin.
// Safe to allow from anywhere: these routes go by the token in the
// Authorization header, never a cookie, so another site can't act as
// whoever's signed in to this one.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

export async function handleMobileCors<T extends { response: Response }>(
  request: Request,
  next: () => T | Promise<T>,
): Promise<T | Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  const result = await next()
  const headers = new Headers(result.response.headers)
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
  const { response } = result
  return { ...result, response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }) }
}

const absolute = (request: Request, path: string | null) => path && siteUrl(request, path)

export function mobilePodcast(
  request: Request,
  podcast: { id: string; slug: string; title: string; imageUrl: string | null; private?: boolean; description?: string | null },
) {
  return {
    id: podcast.id,
    slug: podcast.slug,
    title: podcast.title,
    description: podcast.description ? htmlToText(podcast.description) : null,
    imageUrl: absolute(request, podcast.imageUrl),
    private: podcast.private ?? false,
  }
}

type OwnedEpisode = Awaited<ReturnType<typeof listEpisodes>>[number]

// One of the user's own episodes, in any state, with its live progress.
export function mobileEpisode(request: Request, episode: OwnedEpisode) {
  return {
    id: episode.id,
    slug: episode.slug,
    title: episode.title,
    description: episode.description ? htmlToText(episode.description) : null,
    sourceUrl: episode.sourceUrl,
    imageUrl: absolute(request, episode.imageUrl),
    audioUrl: episode.status === 'ready' ? absolute(request, episode.audioUrl) : null,
    durationSeconds: episode.durationSeconds,
    status: episode.status,
    error: episode.error,
    private: episode.private,
    createdAt: episode.createdAt,
    publishedAt: episode.publishedAt,
    positionSeconds: episode.positionSeconds ?? 0,
    progress: getEpisodeProgress(episode.id),
  }
}

type ListenerEpisode = Awaited<ReturnType<typeof listContinueListening>>[number]

// An episode to carry on listening to, from any podcast the user can see.
export function mobileListenerEpisode(request: Request, episode: ListenerEpisode) {
  return {
    id: episode.id,
    slug: episode.slug,
    title: episode.title,
    imageUrl: absolute(request, episode.imageUrl ?? episode.podcast.imageUrl),
    audioUrl: absolute(request, episode.audioUrl),
    durationSeconds: episode.durationSeconds,
    positionSeconds: episode.positionSeconds ?? 0,
    podcast: { slug: episode.podcast.slug, title: episode.podcast.title },
  }
}

// The theme colours the app uses (its tailwind.config.js), of those the site's
// theme sets (theme-schema.ts).
const appColourKeys = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
] as const satisfies readonly (keyof ModeStyles)[]

// One mode of the theme for the app: its colours as HSL triplets (leaving out
// any it can't convert, which then keep the app's defaults), and its corner
// radius, from the other mode if only that gives one, as on the site.
function appMode(styles: ModeStyles, other: ModeStyles) {
  const colours: Record<string, string> = {}
  for (const key of appColourKeys) {
    const triplet = styles[key] && cssColourToHslTriplet(styles[key])
    if (triplet) colours[key] = triplet
  }
  return { colours, radius: styles.radius ?? other.radius ?? null }
}

// The site's theme, as admins set it on the Theme tab, for the app to match;
// null while the site has app.css's own, which the app has built in.
export async function mobileTheme() {
  const { siteTheme } = await getSiteSettings()
  if (!siteTheme) return null
  const { light, dark } = siteTheme.styles
  return { basedOn: siteTheme.basedOn, light: appMode(light, dark), dark: appMode(dark, light) }
}
