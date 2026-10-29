// Reports of images that shouldn't be on the site (see reports.server.ts):
// what a visitor sends, and what an admin does about one.
import { z } from 'zod'

// What can be reported: a podcast's or episode's artwork, or a profile picture.
export const reportTargetKinds = ['podcast', 'episode', 'user'] as const
export type ReportTargetKind = (typeof reportTargetKinds)[number]

export const reportReasons = ['childSafety', 'sexual', 'violence', 'hate', 'other'] as const
export type ReportReason = (typeof reportReasons)[number]

export const reportReasonNames: Record<ReportReason, string> = {
  childSafety: 'It may show a child being harmed or sexualised',
  sexual: 'Nudity or sexual content',
  violence: 'Violence or gore',
  hate: 'Hate or harassment',
  other: 'Something else',
}

export const reportSchema = z.object({
  targetKind: z.enum(reportTargetKinds),
  targetId: z.string().min(1).max(100),
  reason: z.enum(reportReasons),
  details: z
    .string()
    .trim()
    .max(1000, 'Please keep it under 1000 characters')
    .optional()
    .transform((value) => value || null),
})
export type ReportInput = z.infer<typeof reportSchema>

// Remove: delete the image. Preserve: take it down but keep a copy, never
// served, for a report to the authorities (always for child abuse imagery).
// Dismiss: leave it.
export const reportResolutions = ['removed', 'preserved', 'dismissed'] as const
export type ReportResolution = (typeof reportResolutions)[number]

export const resolveReportSchema = z.object({
  reportId: z.string().min(1),
  resolution: z.enum(reportResolutions),
})
