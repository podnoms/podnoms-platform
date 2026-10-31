// What the mobile app's API (src/routes/api/mobile/*) sends back: episodes and
// shows with full URLs, as the app isn't on this site, and descriptions as
// plain text, as it doesn't render HTML.
import '@tanstack/react-start/server-only'
import { and, eq, or } from 'drizzle-orm'
import { cssColourToHslTriplet } from '~/lib/colour'
import { htmlToText } from '~/lib/rich-text'
import type { ModeStyles } from '~/lib/theme-schema'
import { storedMentionPattern } from '~/lib/user-slug'
import { listComments, type CommentReply, type EpisodeComment } from '~/server/comments.server'
import { getAppPushPrefs } from '~/server/app-push.server'
import { db } from '~/server/db/client.server'
import { episodes, playbackPositions, shows } from '~/server/db/schema'
import { getEpisodeProgress } from '~/server/episode-processor.server'
import { listenerPosition, visibleTo, type listEpisodes, type listPublishedEpisodes } from '~/server/episodes.server'
import { noteAppViewer, viewerCount } from '~/server/live-events.server'
import { getOpenBroadcast, gifConfig, liveEnabled, listChat, liveShowIdsAmong, type ChatMessage } from '~/server/live.server'
import { siteUrl } from '~/server/extension-api.server'
import { listFollowedShows, listTrendingShows, type listContinueListening } from '~/server/library.server'
import { listFollowNotify } from '~/server/follower-notifications.server'
import { getPublicShow, listShows } from '~/server/shows.server'
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

export function mobileShow(
  request: Request,
  show: { id: string; slug: string; title: string; imageUrl: string | null; private?: boolean; description?: string | null },
  // Whether it's broadcasting right now, for a badge linking to its live page.
  live: boolean,
) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description ? htmlToText(show.description) : null,
    imageUrl: absolute(request, show.imageUrl),
    private: show.private ?? false,
    live,
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

type PublishedEpisode = Awaited<ReturnType<typeof listPublishedEpisodes>>[number]

// An episode of someone else's show, in the same shape: always ready, with
// nothing about how it was made.
export function mobilePublishedEpisode(request: Request, episode: PublishedEpisode) {
  return {
    id: episode.id,
    slug: episode.slug,
    title: episode.title,
    description: episode.description ? htmlToText(episode.description) : null,
    sourceUrl: null,
    imageUrl: absolute(request, episode.imageUrl),
    audioUrl: absolute(request, episode.audioUrl),
    durationSeconds: episode.durationSeconds,
    status: 'ready' as const,
    error: null,
    private: false,
    createdAt: episode.createdAt,
    publishedAt: episode.publishedAt,
    positionSeconds: episode.positionSeconds ?? 0,
    progress: null,
  }
}

type ListenerEpisode = Awaited<ReturnType<typeof listContinueListening>>[number]

// An episode to carry on listening to, from any show the user can see.
export function mobileListenerEpisode(request: Request, episode: ListenerEpisode) {
  return {
    id: episode.id,
    slug: episode.slug,
    title: episode.title,
    imageUrl: absolute(request, episode.imageUrl ?? episode.show.imageUrl),
    audioUrl: absolute(request, episode.audioUrl),
    durationSeconds: episode.durationSeconds,
    positionSeconds: episode.positionSeconds ?? 0,
    show: { slug: episode.show.slug, title: episode.show.title },
  }
}

type ShowCard = Awaited<ReturnType<typeof listTrendingShows>>[number]

function mobileShowCard(request: Request, show: ShowCard, live: boolean) {
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    author: show.author,
    imageUrl: absolute(request, show.imageUrl),
    episodeCount: show.episodeCount,
    followerCount: show.followerCount,
    live,
  }
}

// The app's home page: the shows the user follows, shows to discover, and any
// of their own.
export async function mobileHome(request: Request, userId: string) {
  const [following, trending, yours] = await Promise.all([
    listFollowedShows(userId),
    listTrendingShows(userId),
    listShows(userId),
  ])
  const live = await liveShowIdsAmong([...following, ...trending, ...yours].map((show) => show.id))
  return {
    following: following.map((show) => mobileShowCard(request, show, live.has(show.id))),
    trending: trending.map((show) => mobileShowCard(request, show, live.has(show.id))),
    yours: yours.map((show) => mobileShow(request, show, live.has(show.id))),
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
// any they may see (from Continue listening, say), with its show, the
// comments (only on ready episodes) and how to search for GIFs to add to
// them. Null if they can't see it.
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
      show: { id: shows.id, slug: shows.slug, title: shows.title, imageUrl: shows.imageUrl, ownerId: shows.userId },
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .leftJoin(playbackPositions, listenerPosition(userId))
    .where(and(eq(episodes.id, episodeId), or(eq(shows.userId, userId), visibleTo(userId))))
    .limit(1)
  if (!row) return null
  const { show, ...episode } = row
  const isOwner = show.ownerId === userId
  const comments = episode.status === 'ready' ? await listComments(episode.id, userId) : []
  return {
    episode: {
      ...episode,
      description: episode.description ? htmlToText(episode.description) : null,
      imageUrl: absolute(request, episode.imageUrl ?? show.imageUrl),
      audioUrl: episode.status === 'ready' ? absolute(request, episode.audioUrl) : null,
      positionSeconds: episode.positionSeconds ?? 0,
      // Only the owner sees where it came from, or why it failed.
      sourceUrl: isOwner ? episode.sourceUrl : null,
      error: isOwner ? episode.error : null,
      progress: isOwner ? getEpisodeProgress(episode.id) : null,
    },
    show: { id: show.id, slug: show.slug, title: show.title, imageUrl: absolute(request, show.imageUrl), isOwner },
    comments: comments.map((comment) => mobileComment(request, comment)),
    // The GIF provider and its public key, for the app to search with, as
    // the site's pages get them; null when none is set up.
    gifs: gifConfig(),
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

// --- Live pages -----------------------------------------------------------------

export function mobileChatMessage(request: Request, message: ChatMessage) {
  return {
    id: message.id,
    author: { name: message.author.name, imageUrl: absolute(request, message.author.image) },
    body: message.body,
    gif: message.gif,
    createdAt: message.createdAt,
    canDelete: message.canDelete,
  }
}

// A show's live page in the app, which it asks for every few seconds as it
// has no event stream: what's on, if anything, where to watch it, its chat so
// far and how many are watching, this viewer among them. Null if live
// broadcasts aren't set up or they can't see the show.
export async function mobileLivePage(request: Request, userId: string, slug: string) {
  if (!liveEnabled()) return null
  const show = await getPublicShow(slug, userId)
  if (!show) return null
  noteAppViewer(show.id, userId)
  const broadcast = await getOpenBroadcast(show.id)
  const chat = broadcast ? await listChat(show, broadcast.id, userId) : []
  return {
    show: { id: show.id, slug: show.slug, title: show.title, author: show.author, imageUrl: absolute(request, show.imageUrl) },
    broadcast: broadcast && {
      id: broadcast.id,
      title: broadcast.title,
      startedAt: broadcast.startedAt,
      // The stream has dropped out, and may come back.
      interrupted: broadcast.interruptedAt !== null,
    },
    hlsUrl: siteUrl(request, `/api/mobile/live/${encodeURIComponent(show.slug)}/hls/index.m3u8`),
    chat: chat.map((message) => mobileChatMessage(request, message)),
    viewers: viewerCount(show.id),
    gifs: gifConfig(),
  }
}

// --- Notifications ----------------------------------------------------------------

// The app's notification settings: which kinds the user gets, and the shows
// they follow, which they can mute one by one.
export async function mobileNotificationSettings(request: Request, userId: string) {
  const [prefs, follows] = await Promise.all([getAppPushPrefs(userId), listFollowNotify(userId)])
  return {
    live: prefs?.live ?? true,
    newEpisodes: prefs?.newEpisodes ?? true,
    shows: follows.map((follow) => ({
      id: follow.showId,
      slug: follow.slug,
      title: follow.title,
      imageUrl: absolute(request, follow.imageUrl),
      notify: follow.notify,
    })),
  }
}
