import { z } from 'zod'
import { descriptionHtml, imageChange } from '~/lib/podcast-schema'

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || undefined)
    .optional()

// The largest audio file that can be uploaded as an episode.
export const maxUploadBytes = 1024 * 1024 * 1024

const episodeDetails = {
  podcastId: z.string().min(1),
  // Left blank, the title and description come from the source.
  title: optionalText(200, 'Keep the title under 200 characters'),
  description: optionalText(4000, 'Keep the description under 4000 characters'),
}

// The video or audio to turn into an episode, e.g. a YouTube link.
const sourceUrl = z
  .string()
  .trim()
  .min(1, 'Paste a link to the video or audio')
  .pipe(z.url('Enter a full link, starting with https://').max(2000))

// A file the user has uploaded (see /api/uploads).
const uploadId = z.uuid('Choose an audio file to upload')

// An episode made from a link, which is downloaded.
export const linkEpisodeSchema = z.object({ ...episodeDetails, sourceUrl })

// An episode made from a file the user has uploaded.
export const uploadEpisodeSchema = z.object({ ...episodeDetails, uploadId })

export const newEpisodeSchema = z.union([linkEpisodeSchema, uploadEpisodeSchema])
export type NewEpisodeInput = z.infer<typeof newEpisodeSchema>

export const editEpisodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, 'Give the episode a title').max(200, 'Keep the title under 200 characters'),
  description: descriptionHtml,
  imageId: imageChange,
})
export type EditEpisodeInput = z.infer<typeof editEpisodeSchema>

// New audio for an episode, from a link or an uploaded file.
export const replaceAudioLinkSchema = z.object({ id: z.string().min(1), sourceUrl })
export const replaceAudioUploadSchema = z.object({ id: z.string().min(1), uploadId })
export const replaceAudioSchema = z.union([replaceAudioLinkSchema, replaceAudioUploadSchema])
export type ReplaceAudioInput = z.infer<typeof replaceAudioSchema>
