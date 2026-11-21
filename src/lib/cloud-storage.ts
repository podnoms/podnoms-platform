// Cloud storage that folders of audio can be uploaded from (see
// cloud-storage.server.ts), shared by the browser and the server.
import { z } from 'zod'

export const cloudProviders = ['dropbox', 'box'] as const
export type CloudProvider = (typeof cloudProviders)[number]

export const cloudProviderNames: Record<CloudProvider, string> = { dropbox: 'Dropbox', box: 'Box' }

export const isCloudProvider = (value: string): value is CloudProvider =>
  (cloudProviders as readonly string[]).includes(value)

// Folders and files are named by what each provider takes for them: Dropbox
// folders by path ('' is the top) and files by ID ("id:…"), Box's by number
// ('0' is the top).
const folderId = z.union([z.literal(''), z.string().regex(/^\/[^\u0000-\u001f]{1,1000}$/), z.string().regex(/^\d{1,20}$/)])
const fileId = z.union([z.string().regex(/^id:[\w-]{1,100}$/), z.string().regex(/^\d{1,20}$/)])

export const cloudFolderSchema = z.object({
  provider: z.enum(cloudProviders),
  folderId: folderId.optional(),
})

export const cloudFileSchema = z.object({
  provider: z.enum(cloudProviders),
  fileId,
  // Only for the episode's title, as with an upload's name.
  name: z.string().max(1000),
})

export type CloudFolderEntry = { id: string; name: string }
export type CloudFile = CloudFolderEntry & { size: number }

export type CloudFolder = {
  id: string
  name: string
  // The folders above it, from the top.
  parents: CloudFolderEntry[]
  folders: CloudFolderEntry[]
  // Only its audio and video.
  files: CloudFile[]
}

// The message the sign-in popup sends the page that opened it.
export type CloudConnectedMessage = { type: 'cloud-storage-connected'; provider: CloudProvider; ok: boolean }
