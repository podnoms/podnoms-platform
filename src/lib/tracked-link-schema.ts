import { z } from 'zod'

export const trackedLinkLabelMaxLength = 80

export const createTrackedLinkSchema = z.object({
  episodeId: z.string().min(1),
  label: z.string().trim().min(1, 'Say who the link is for').max(trackedLinkLabelMaxLength),
})

export const deleteTrackedLinkSchema = z.object({ id: z.string().min(1) })

// What a share page reports to /api/tracked-links/$token.
export const trackedLinkVisitSchema = z.object({
  type: z.enum(['open', 'play']),
  episodeId: z.string().min(1),
})

export type TrackedLinkVisit = z.infer<typeof trackedLinkVisitSchema>
