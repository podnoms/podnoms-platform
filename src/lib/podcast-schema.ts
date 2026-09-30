import { z } from 'zod'

export const newPodcastSchema = z.object({
  title: z.string().trim().min(1, 'Give your podcast a title').max(100, 'Keep the title under 100 characters'),
  description: z
    .string()
    .trim()
    .max(4000, 'Keep the description under 4000 characters')
    .transform((value) => value || undefined)
    .optional(),
})
export type NewPodcastInput = z.infer<typeof newPodcastSchema>
