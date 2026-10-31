import { z } from 'zod'
import { descriptionHtml, imageChange } from '~/lib/show-schema'
import { userSlugSchema } from '~/lib/user-slug'

export const editProfileSchema = z.object({
  // Blank clears the name, so the email is shown instead.
  name: z
    .string()
    .trim()
    .max(100, 'Keep your name under 100 characters')
    .transform((value) => value || null),
  // Left out, it stays as it is.
  slug: userSlugSchema.optional(),
  description: descriptionHtml,
  imageId: imageChange,
})
export type EditProfileInput = z.infer<typeof editProfileSchema>

// Which emails the user gets about their shows, and the ones they follow.
export const notificationPrefsSchema = z.object({
  notifyEpisodeFailed: z.boolean(),
  notifyNewEpisodes: z.boolean(),
  emailLive: z.boolean(),
  emailFollowedEpisodes: z.boolean(),
  emailMentions: z.boolean(),
})

// Mutes or unmutes a show the user follows, for every kind of notification.
export const followNotifySchema = z.object({
  showId: z.string().min(1),
  notify: z.boolean(),
})
