// The URL of an image for display at the given CSS width. Stored images are
// asked for at twice that, for high-density screens (the server rounds up to
// a size it keeps); other URLs are left as they are.
export function imageSrc(url: string, width: number) {
  return url.startsWith('/images/') ? `${url}?w=${width * 2}` : url
}

// The size of the image made for link previews: 1.91:1, as Open Graph
// consumers recommend.
export const openGraphImageSize = { width: 1200, height: 630 } as const

// The image for link previews of a page with this artwork: for stored images,
// the copy laid out for them (a JPEG of known size); other URLs as they are.
export function openGraphImage(url: string): { url: string; width?: number; height?: number } {
  return url.startsWith('/images/') ? { url: `${url}?og`, ...openGraphImageSize } : { url }
}
