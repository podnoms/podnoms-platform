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

// Descriptions are HTML from the rich text editor, sanitised on the server.
export const descriptionHtml = z.string().max(20000, 'That description is too long').optional()

// The image field of an edit form: an uploaded image's ID (see /api/images) to
// use, null to remove the image, or left out to keep it.
export const imageChange = z.uuid().nullable().optional()

export const editPodcastSchema = z.object({
  id: z.string().min(1),
  title: newPodcastSchema.shape.title,
  description: descriptionHtml,
  imageId: imageChange,
})
export type EditPodcastInput = z.infer<typeof editPodcastSchema>
