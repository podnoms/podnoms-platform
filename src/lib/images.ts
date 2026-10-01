// The URL of an image for display at the given CSS width. Stored images are
// asked for at twice that, for high-density screens (the server rounds up to
// a size it keeps); other URLs are left as they are.
export function imageSrc(url: string, width: number) {
  return url.startsWith('/images/') ? `${url}?w=${width * 2}` : url
}
