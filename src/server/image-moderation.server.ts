// Checks every image coming into the site (uploads, suggestions, thumbnails)
// with Azure AI Content Safety, so artwork stays family-friendly. Azure rates
// each image 0 (safe), 2 (low), 4 (medium) or 6 (high) for sexual content,
// violence, hate and self-harm; an image over the admin's limit for any of
// them is refused (limits in the imageModeration site setting). Off unless
// AZURE_CONTENT_SAFETY_ENDPOINT and _KEY are set. When it's on and Azure
// can't be reached, images are refused rather than let through unchecked.
import '@tanstack/react-start/server-only'
import sharp from 'sharp'
import { env } from '~/env'
import type { ModerationCategory } from '~/lib/image-moderation'
import { getSiteSettings } from '~/server/site-settings.server'

// Overridable in tests.
export const contentSafety = {
  endpoint: env.AZURE_CONTENT_SAFETY_ENDPOINT,
  key: env.AZURE_CONTENT_SAFETY_KEY,
}

const apiVersion = '2024-09-01'
// Azure takes up to 4 MB and 7200px; a smaller copy is plenty to judge by.
const checkedSide = 1024

const azureCategories: Record<string, ModerationCategory> = {
  Sexual: 'sexual',
  Violence: 'violence',
  Hate: 'hate',
  SelfHarm: 'selfHarm',
}

export class ModerationUnavailableError extends Error {}

export type ModerationResult =
  | { allowed: true }
  | { allowed: false; category: ModerationCategory; severity: number }

export const imageModerationEnabled = () => Boolean(contentSafety.endpoint && contentSafety.key)

// Whether the image at `path` may be used. Throws ModerationUnavailableError
// when it can't be checked.
export async function moderateImage(path: string): Promise<ModerationResult> {
  if (!imageModerationEnabled()) return { allowed: true }
  const image = await sharp(path)
    .resize(checkedSide, checkedSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  let severities: { category: string; severity: number }[]
  try {
    const url = new URL(`contentsafety/image:analyze?api-version=${apiVersion}`, contentSafety.endpoint!.replace(/\/?$/, '/'))
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': contentSafety.key! },
      body: JSON.stringify({
        image: { content: image.toString('base64') },
        categories: Object.keys(azureCategories),
        outputType: 'FourSeverityLevels',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
    severities = ((await response.json()) as { categoriesAnalysis?: typeof severities }).categoriesAnalysis ?? []
  } catch (error) {
    throw new ModerationUnavailableError('Azure Content Safety could not check an image', { cause: error })
  }

  const { imageModeration: limits } = await getSiteSettings()
  // The worst category over its limit, if any.
  let worst: ModerationResult = { allowed: true }
  for (const { category: name, severity } of severities) {
    const category = azureCategories[name]
    if (!category || severity <= limits[category]) continue
    if (worst.allowed || severity > worst.severity) worst = { allowed: false, category, severity }
  }
  return worst
}
