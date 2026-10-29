// What the mobile app's API (src/routes/api/mobile/*) sends back: episodes and
// podcasts with full URLs, as the app isn't on this site, and descriptions as
// plain text, as it doesn't render HTML.
import '@tanstack/react-start/server-only'
import { and, eq, or } from 'drizzle-orm'
import { cssColourToHslTriplet } from '~/lib/colour'
import { htmlToText } from '~/lib/rich-text'
import type { ModeStyles } from '~/lib/theme-schema'
import { storedMentionPattern } from '~/lib/user-slug'
import { listComments, type CommentReply, type EpisodeComment } from '~/server/comments.server'
import { db } from '~/server/db/client.server'
import { episodes, playbackPositions, podcasts } from '~/server/db/schema'
import { getEpisodeProgress } from '~/server/episode-processor.server'
import { listenerPosition, visibleTo, type listEpisodes } from '~/server/episodes.server'
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

// --- Episode pages ------------------------------------------------------------

// An episode for its page in the app: one of the user's own, in any state, or
// any they may see (from Continue listening, say), with its podcast and the
// comments, which are only on ready episodes. Null if they can't see it.
export async function mobileEpisodePage(request: Request, userId: string, episodeId: string) {
  const [row] = await db
    .select({
      id: episodes.id,
      slug: episodes.slug,
      title: episodes.title,
      description: episodes.description,
      sourceUrl: episodes.sourceUrl,
      imageUrl: episodes.imageUrl,
      audioUrl: episodes.audioUrl,
      durationSeconds: episodes.durationSeconds,
      status: episodes.status,
      error: episodes.error,
      private: episodes.private,
      createdAt: episodes.createdAt,
      publishedAt: episodes.publishedAt,
      positionSeconds: playbackPositions.positionSeconds,
      podcast: { id: podcasts.id, slug: podcasts.slug, title: podcasts.title, imageUrl: podcasts.imageUrl, ownerId: podcasts.userId },
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .leftJoin(playbackPositions, listenerPosition(userId))
    .where(and(eq(episodes.id, episodeId), or(eq(podcasts.userId, userId), visibleTo(userId))))
    .limit(1)
  if (!row) return null
  const { podcast, ...episode } = row
  const isOwner = podcast.ownerId === userId
  const comments = episode.status === 'ready' ? await listComments(episode.id, userId) : []
  return {
    episode: {
      ...episode,
      description: episode.description ? htmlToText(episode.description) : null,
      imageUrl: absolute(request, episode.imageUrl ?? podcast.imageUrl),
      audioUrl: episode.status === 'ready' ? absolute(request, episode.audioUrl) : null,
      positionSeconds: episode.positionSeconds ?? 0,
      // Only the owner sees where it came from, or why it failed.
      sourceUrl: isOwner ? episode.sourceUrl : null,
      error: isOwner ? episode.error : null,
      progress: isOwner ? getEpisodeProgress(episode.id) : null,
    },
    podcast: { id: podcast.id, slug: podcast.slug, title: podcast.title, imageUrl: absolute(request, podcast.imageUrl), isOwner },
    comments: comments.map((comment) => mobileComment(request, comment)),
  }
}

// A comment's text in pieces, with its <@userId> mentions as the users they
// stand for, so the app can show them as @slug.
function bodySegments(body: string, mentions: CommentReply['mentions']) {
  const segments: ({ text: string } | { mention: { slug: string; name: string | null } })[] = []
  let last = 0
  for (const match of body.matchAll(storedMentionPattern)) {
    if (match.index > last) segments.push({ text: body.slice(last, match.index) })
    const user = mentions[match[1]!]
    segments.push(user ? { mention: user } : { text: '@someone' })
    last = match.index + match[0].length
  }
  if (last < body.length) segments.push({ text: body.slice(last) })
  return segments
}

function mobileReply(request: Request, comment: CommentReply) {
  return {
    id: comment.id,
    author: {
      name: comment.author.name,
      slug: comment.author.slug,
      imageUrl: absolute(request, comment.author.image),
    },
    body: bodySegments(comment.body, comment.mentions),
    gif: comment.gif,
    atSeconds: comment.atSeconds,
    createdAt: comment.createdAt,
    likeCount: comment.likeCount,
    liked: comment.liked,
    canDelete: comment.canDelete,
  }
}

export function mobileComment(request: Request, comment: EpisodeComment) {
  return { ...mobileReply(request, comment), replies: comment.replies.map((reply) => mobileReply(request, reply)) }
}
