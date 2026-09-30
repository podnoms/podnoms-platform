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
  title: z.string().trim().min(1, 'Give the episode a title').max(200, 'Keep the title under 200 characters'),
  // Where the audio comes from, e.g. a YouTube or Mixcloud link.
  sourceUrl: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .pipe(z.url('Enter a full link, starting with https://').max(2000).optional())
    .optional(),
  description: optionalText(4000, 'Keep the description under 4000 characters'),
})
export type NewEpisodeInput = z.infer<typeof newEpisodeSchema>
