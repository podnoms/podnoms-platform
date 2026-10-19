// What a link to a video or show says about itself (title, description,
// artwork), from the platform's quick public endpoints rather than yt-dlp:
//   - for the new episode form, filled in as soon as a link is pasted;
//   - for an episode added from a link, its artwork, saved as soon as it's
//     added rather than once its download gets a slot in the download
//     throttle, which can be a while. The processor keeps whatever this saves;
//     if it fails, the source's thumbnail is used once yt-dlp has looked the
//     source up, as before.
// Each is a request or two (none to YouTube itself for artwork, whose
// thumbnails are on its image CDN at known addresses), so they don't wait for
// a slot, but nothing is sent to a platform that's refusing us.
import '@tanstack/react-start/server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { platformOf } from '~/lib/platforms'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes } from '~/server/db/schema'
import { isCoolingDown } from '~/server/download-throttle.server'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { downloadImage, stageImage } from '~/server/images.server'
import { logger } from '~/server/logger.server'

// Overridable in tests.
export const linkDetailSources = {
  youtube: 'https://www.youtube.com',
  youtubeImages: 'https://i.ytimg.com',
  soundcloud: 'https://soundcloud.com',
  mixcloudApi: 'https://api.mixcloud.com',
}

// watch?v=…, youtu.be/…, /shorts/…, /live/… and /embed/… links.
export function youtubeVideoId(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    const [first, second] = url.pathname.split('/').filter(Boolean)
    const id = url.hostname.toLowerCase().endsWith('youtu.be')
      ? first
      : first === 'watch'
        ? url.searchParams.get('v')
        : ['shorts', 'live', 'embed', 'v'].includes(first ?? '')
          ? second
          : null
    return id && /^[\w-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'podnoms (+https://podnoms.com)' },
    signal: AbortSignal.timeout(15_000),
  })
  return response.ok ? ((await response.json()) as T) : null
}

type OEmbed = { title?: string; description?: string; author_name?: string; thumbnail_url?: string }

function oEmbed(base: string, sourceUrl: string) {
  return getJson<OEmbed>(`${base}/oembed?${new URLSearchParams({ format: 'json', url: sourceUrl })}`)
}

type Details = {
  title: string | null
  description: string | null
  // The images to try, best first.
  images: string[]
}

const none: Details = { title: null, description: null, images: [] }

// `text` asks for the title and description too, which for YouTube takes a
// request its artwork doesn't.
async function lookUp(sourceUrl: string, { text }: { text: boolean }): Promise<Details> {
  switch (platformOf(sourceUrl)) {
    case 'youtube': {
      const id = youtubeVideoId(sourceUrl)
      if (!id) return none
      // maxresdefault is missing for some older videos; hqdefault never is.
      const images = ['maxresdefault', 'sddefault', 'hqdefault'].map((name) => `${linkDetailSources.youtubeImages}/vi/${id}/${name}.jpg`)
      // oEmbed has no description; the processor fills it in if it's left blank.
      const embed = text ? await oEmbed(linkDetailSources.youtube, `https://www.youtube.com/watch?v=${id}`) : null
      return { title: embed?.title ?? null, description: null, images }
    }
    case 'soundcloud': {
      const embed = await oEmbed(linkDetailSources.soundcloud, sourceUrl)
      if (!embed) return none
      // "Track by Artist", where the track is called "Track".
      const byline = embed.author_name && ` by ${embed.author_name}`
      const title = byline && embed.title?.endsWith(byline) ? embed.title.slice(0, -byline.length) : embed.title
      // Its description is HTML; the form's is plain text.
      return { title: title ?? null, description: embed.description ? htmlToText(embed.description) : null, images: embed.thumbnail_url ? [embed.thumbnail_url] : [] }
    }
    case 'mixcloud': {
      // A show is at /<user>/<show>/, and so is its entry in Mixcloud's API.
      const parts = new URL(sourceUrl).pathname.split('/').filter(Boolean)
      if (parts.length !== 2) return none
      const show = await getJson<{ name?: string; description?: string; pictures?: Record<string, string | undefined> }>(
        `${linkDetailSources.mixcloudApi}/${parts.map(encodeURIComponent).join('/')}/`,
      )
      const pictures = show?.pictures ?? {}
      const picture = pictures['1024wx1024h'] ?? pictures['640wx640h'] ?? pictures.extra_large ?? pictures.large
      return { title: show?.name ?? null, description: show?.description ?? null, images: picture ? [picture] : [] }
    }
    default:
      return none
  }
}

function lookUpPolitely(sourceUrl: string, options: { text: boolean }) {
  return isCoolingDown(platformOf(sourceUrl)) ? none : lookUp(sourceUrl, options)
}

export type LinkDetails = {
  title: string | null
  description: string | null
  // Staged like an upload, so the form can be saved with it.
  image: { imageId: string; previewUrl: string } | null
}

// The link's details, to fill in the new episode form, cut to what the form takes.
export async function lookUpLink(userId: string, sourceUrl: string): Promise<LinkDetails> {
  try {
    const details = await lookUpPolitely(sourceUrl, { text: true })
    return {
      title: details.title?.trim().slice(0, 200) || null,
      description: details.description?.trim().slice(0, 4000) || null,
      image: await stageFirstImage(userId, details.images),
    }
  } catch (error) {
    logger.warn({ sourceUrl, err: error }, "Could not look up the link's details")
    return { title: null, description: null, image: null }
  }
}

async function stageFirstImage(userId: string, images: string[]) {
  for (const previewUrl of images) {
    try {
      const response = await fetch(previewUrl, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok || !response.body) continue
      const { imageId } = await stageImage(userId, response.body)
      return { imageId, previewUrl }
    } catch {
      // Not an image after all; try the next.
    }
  }
  return null
}

// Saves the link's artwork as the episode's image, unless it has one by then.
export async function saveLinkArtwork(episodeId: string, sourceUrl: string) {
  try {
    for (const candidate of (await lookUpPolitely(sourceUrl, { text: false })).images) {
      const imageUrl = await downloadImage(candidate)
      if (!imageUrl) continue
      const saved = await db
        .update(episodes)
        .set({ imageUrl })
        .where(and(eq(episodes.id, episodeId), isNull(episodes.imageUrl)))
        .returning({ id: episodes.id })
      // Left for media cleanup if the episode got an image meanwhile.
      if (saved.length) publishEpisodeEvent({ type: 'changed', episodeId })
      return
    }
  } catch (error) {
    logger.warn({ episodeId, sourceUrl, err: error }, "Could not fetch the link's artwork early")
  }
}
