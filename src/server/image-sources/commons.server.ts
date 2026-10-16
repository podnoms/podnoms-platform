import '@tanstack/react-start/server-only'
import { htmlToText } from '~/lib/rich-text'
import { userAgent, type ImageSource } from '~/server/image-sources/image-source.server'

type CommonsPage = {
  pageid: number
  // Rank in the search results; pages come back unordered.
  index: number
  imageinfo?: {
    thumburl?: string
    descriptionurl: string
    extmetadata?: { Artist?: { value: string }; License?: { value: string } }
  }[]
}

// CC0 (P275 licence) or public domain (P6216 copyright status) in a file's
// structured data, so photos are free to keep without credit.
const freeLicenses = 'haswbstatement:P275=Q6938433|P6216=Q19652'

// The author is HTML, usually a link to their user page.
function author(html: string | undefined) {
  if (!html) return { author: null, authorUrl: null }
  const href = /href="([^"]+)"/.exec(html)?.[1]
  return {
    author: htmlToText(html).trim() || null,
    authorUrl: href ? new URL(href, 'https://commons.wikimedia.org').toString() : null,
  }
}

// Wikimedia Commons (commons.wikimedia.org) needs no key; Wikimedia asks only
// for a User-Agent saying who we are.
export const commons: ImageSource = {
  name: 'commons',
  async search(query) {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: `${query} filetype:bitmap ${freeLicenses}`,
      gsrnamespace: '6',
      gsrlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'Artist|License',
      // Scaled by Wikimedia to the size podcast apps want; staging crops it square.
      iiurlwidth: '1400',
    }).toString()
    const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Commons search failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
    const body = (await response.json()) as { query?: { pages: CommonsPage[] }; error?: { code: string; info: string } }
    if (body.error) throw new Error(`Commons search failed: ${body.error.code} ${body.error.info}`)
    return (body.query?.pages ?? [])
      .sort((a, b) => a.index - b.index)
      .flatMap((page) => {
        const info = page.imageinfo?.[0]
        // The file's own licence template, in case its structured data disagrees.
        const license = info?.extmetadata?.License?.value ?? ''
        if (!info?.thumburl || !/^(cc0|pd)/.test(license)) return []
        return [
          {
            id: String(page.pageid),
            downloadUrl: info.thumburl,
            previewUrl: info.thumburl,
            credit: {
              ...author(info.extmetadata?.Artist?.value),
              pageUrl: info.descriptionurl,
              source: 'Wikimedia Commons',
              sourceUrl: 'https://commons.wikimedia.org',
              preposition: 'on' as const,
            },
          },
        ]
      })
  },
}
