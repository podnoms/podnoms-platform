import { z } from 'zod'

// What a browser reports to /api/episodes/$id/activity. Downloads aren't
// here: the audio endpoint records those itself.
export const reportedActivitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), source: z.enum(['web', 'listen', 'embed']), referrer: z.string().max(2048).optional() }),
  z.object({
    type: z.literal('share'),
    source: z.enum(['web', 'listen', 'embed']),
    detail: z.enum(['link', 'embed']),
    referrer: z.string().max(2048).optional(),
  }),
])

export type ReportedActivity = z.infer<typeof reportedActivitySchema>

// The periods the stats can cover, in days.
export const activityPeriods = [7, 30, 90] as const

export const activityQuerySchema = z.object({
  slug: z.string(),
  episodeSlug: z.string().optional(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
})

export const dashboardQuerySchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
})
