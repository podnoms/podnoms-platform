// GIFs for live chat, from KLIPY or GIPHY (whichever has a key, see
// gifConfig in live.server.ts). Both providers require searches and GIF files
// to go straight between the viewer's browser and them, so this runs in the
// browser with the provider's (public) key; podnoms only stores the chosen
// GIF's details with the message, its URL exactly as the provider gave it.
import { z } from 'zod'

export const gifProviders = ['klipy', 'giphy'] as const
export type GifProvider = (typeof gifProviders)[number]

// What the browser needs to search: which provider, and its key.
export type GifConfig = { provider: GifProvider; key: string }

// Search results: the content rating chat allows, roughly PG-13 for both.
const giphyRating = 'pg-13'
const klipyContentFilter = 'medium'
export const gifPageSize = 24

// Where each provider serves its GIFs from. A message's GIF must come from
// its provider's servers, so chat can't be used to show other images.
const mediaHosts: Record<GifProvider, RegExp> = {
  klipy: /^static\d*\.klipy\.com$/,
  giphy: /^(media\d*|i)\.giphy\.com$/,
}

export function isProviderMediaUrl(provider: GifProvider, url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && mediaHosts[provider].test(parsed.hostname)
  } catch {
    return false
  }
}

// A GIF as sent in chat: shown at about 200px wide.
export const chatGifSchema = z
  .object({
    provider: z.enum(gifProviders),
    id: z.string().min(1).max(200),
    title: z.string().max(300),
    url: z.string().max(2000),
    width: z.number().int().min(1).max(4000),
    height: z.number().int().min(1).max(4000),
  })
  .refine((gif) => isProviderMediaUrl(gif.provider, gif.url), {
    message: "That GIF isn't from the GIF service",
    path: ['url'],
  })
export type ChatGif = z.infer<typeof chatGifSchema>

// A search result: the GIF to send, and a smaller one for the picker.
export type GifResult = ChatGif & { preview: { url: string; width: number; height: number } }
export type GifPage = { results: GifResult[]; next: number | null }

type Media = { url?: string; width?: number | string; height?: number | string }

function media(file: Media | undefined) {
  const width = Number(file?.width)
  const height = Number(file?.height)
  return file?.url && width > 0 && height > 0 ? { url: file.url, width, height } : null
}

// --- KLIPY (docs.klipy.com/gifs-api) ---------------------------------------

type KlipySize = { gif?: Media; webp?: Media }
type KlipyItem = { id?: number | string; slug?: string; title?: string; file?: Record<string, KlipySize | undefined> }
type KlipyResponse = { data?: { data?: KlipyItem[]; current_page?: number; has_next?: boolean } }

export function fromKlipy(response: KlipyResponse): GifPage {
  const results = (response.data?.data ?? []).flatMap((item): GifResult[] => {
    const file = item.file ?? {}
    const pick = (...sizes: string[]) => {
      for (const size of sizes) {
        const found = media(file[size]?.webp) ?? media(file[size]?.gif)
        if (found) return found
      }
      return null
    }
    const main = pick('md', 'sm', 'hd')
    const preview = pick('xs', 'sm', 'md')
    const id = item.slug ?? (item.id === undefined ? undefined : String(item.id))
    // Items without files (such as ads, which aren't enabled) can't be shown.
    if (!main || !preview || !id) return []
    return [{ provider: 'klipy', id, title: item.title ?? '', ...main, preview }]
  })
  const page = response.data?.current_page ?? 1
  return { results, next: response.data?.has_next ? page + 1 : null }
}

function klipyUrl(config: GifConfig, query: string, page: number) {
  const endpoint = query ? 'search' : 'trending'
  const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(config.key)}/gifs/${endpoint}`)
  url.searchParams.set('page', String(page))
  url.searchParams.set('per_page', String(gifPageSize))
  url.searchParams.set('content_filter', klipyContentFilter)
  url.searchParams.set('format_filter', 'webp,gif')
  if (query) url.searchParams.set('q', query)
  return url
}

// --- GIPHY (developers.giphy.com/docs/api) ---------------------------------

type GiphyImage = Media & { webp?: string }
type GiphyItem = { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> }
type GiphyResponse = { data?: GiphyItem[]; pagination?: { offset?: number; count?: number; total_count?: number } }

// GIPHY's renditions have the WebP as a separate URL alongside the GIF's.
const giphyMedia = (image: GiphyImage | undefined) =>
  image ? (media({ ...image, url: image.webp ?? image.url }) ?? media(image)) : null

export function fromGiphy(response: GiphyResponse): GifPage {
  const results = (response.data ?? []).flatMap((item): GifResult[] => {
    const images = item.images ?? {}
    const main = giphyMedia(images.fixed_width) ?? giphyMedia(images.downsized)
    const preview = giphyMedia(images.fixed_width_small) ?? main
    if (!main || !preview || !item.id) return []
    return [{ provider: 'giphy', id: item.id, title: item.title ?? '', ...main, preview }]
  })
  const { offset = 0, count = results.length, total_count: total = 0 } = response.pagination ?? {}
  const next = offset + count
  return { results, next: count > 0 && next < total ? next : null }
}

function giphyUrl(config: GifConfig, query: string, offset: number) {
  const url = new URL(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}`)
  url.searchParams.set('api_key', config.key)
  url.searchParams.set('limit', String(gifPageSize))
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('rating', giphyRating)
  url.searchParams.set('bundle', 'messaging_non_clips')
  if (query) url.searchParams.set('q', query)
  return url
}

// --- Searching ----------------------------------------------------------------

// The first page of GIFs for `query` (trending ones when it's empty), or the
// page at `next` from an earlier one. Runs in the browser.
export async function searchGifs(config: GifConfig, query: string, next?: number, signal?: AbortSignal): Promise<GifPage> {
  const trimmed = query.trim()
  const url =
    config.provider === 'klipy' ? klipyUrl(config, trimmed, next ?? 1) : giphyUrl(config, trimmed, next ?? 0)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`GIF search failed (${response.status})`)
  const body = (await response.json()) as KlipyResponse & GiphyResponse
  return config.provider === 'klipy' ? fromKlipy(body) : fromGiphy(body)
}

// Only GIPHY asks for its name to be shown where its GIFs are offered.
export const gifAttribution: Record<GifProvider, string | null> = {
  klipy: null,
  giphy: 'Powered by GIPHY',
}
