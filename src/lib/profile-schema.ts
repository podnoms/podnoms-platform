import { z } from 'zod'
import { descriptionHtml, imageChange } from '~/lib/podcast-schema'

export const editProfileSchema = z.object({
  // Blank clears the name, so the email is shown instead.
  name: z
    .string()
    .trim()
    .max(100, 'Keep your name under 100 characters')
    .transform((value) => value || null),
  description: descriptionHtml,
  imageId: imageChange,
})
export type EditProfileInput = z.infer<typeof editProfileSchema>
