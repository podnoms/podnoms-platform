// What the image check (image-moderation.server.ts) looks for, and how strict
// it is about each: the highest severity Azure may give an image in that
// category, 0 (safe) to 6 (high), for it to be allowed.
import { z } from 'zod'

export const moderationCategories = ['sexual', 'violence', 'hate', 'selfHarm'] as const
export type ModerationCategory = (typeof moderationCategories)[number]

export const moderationCategoryNames: Record<ModerationCategory, string> = {
  sexual: 'Sexual content',
  violence: 'Violence',
  hate: 'Hate',
  selfHarm: 'Self-harm',
}

// The choices admins have for each category, by the highest severity allowed.
export const moderationLevels = [
  { value: 0, label: 'Strict', description: 'Refuse anything rated low or above' },
  { value: 2, label: 'Moderate', description: 'Allow low; refuse medium and high' },
  { value: 4, label: 'Lenient', description: 'Refuse only high' },
  { value: 6, label: 'Off', description: 'Allow everything' },
] as const

const level = z.coerce.number().pipe(z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]))

export const imageModerationSchema = z.object({
  sexual: level,
  violence: level,
  hate: level,
  selfHarm: level,
})
export type ImageModerationLimits = z.infer<typeof imageModerationSchema>

// Family-friendly: only mild violence (cartoons, action films) gets through.
export const defaultImageModerationLimits: ImageModerationLimits = { sexual: 0, violence: 2, hate: 0, selfHarm: 0 }
