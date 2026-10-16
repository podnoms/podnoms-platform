// What every source of random artwork provides (see image-suggestions.server.ts,
// which picks one). Adding a source means implementing `ImageSource` in a file
// beside this one and listing it in `imageSources` there.
import '@tanstack/react-start/server-only'

export type ImageCredit = {
  author: string | null
  authorUrl: string | null
  pageUrl: string
  // The source's name and site, credited as "Photo by <author> <preposition> <source>".
  source: string
  sourceUrl: string
  preposition: 'on' | 'from' | 'via'
}

export type Photo = {
  id: string
  // A copy suitable for artwork, to download and keep.
  downloadUrl: string
  previewUrl: string
  credit: ImageCredit
}

export interface ImageSource {
  // Identifies the source in logs and the search cache.
  name: string
  // Photos matching `query`, best matches first.
  search(query: string): Promise<Photo[]>
}

export const userAgent = 'PodNoms (https://podnoms.com)'
