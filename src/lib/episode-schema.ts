import { z } from 'zod'

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || undefined)
    .optional()

export const newEpisodeSchema = z.object({
  podcastId: z.string().min(1),
  // The video or audio to turn into an episode, e.g. a YouTube link.
  sourceUrl: z
    .string()
    .trim()
    .min(1, 'Paste a link to the video or audio')
    .pipe(z.url('Enter a full link, starting with https://').max(2000)),
  // Left blank, the title and description come from the source.
  title: optionalText(200, 'Keep the title under 200 characters'),
  description: optionalText(4000, 'Keep the description under 4000 characters'),
})
export type NewEpisodeInput = z.infer<typeof newEpisodeSchema>
