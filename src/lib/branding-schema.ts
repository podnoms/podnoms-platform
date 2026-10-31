import { z } from 'zod'
import { landingFeatureCount, landingStepCount } from '~/lib/branding'
import { siteThemeSchema } from '~/lib/theme-schema'

const text = (max: number, what: string) => z.string().trim().min(1, `${what} can't be empty`).max(max, `${what} is too long`)

const copyItem = z.object({ title: text(80, 'A title'), description: text(300, 'A description') })

export const landingCopySchema = z.object({
  heroTitle: text(120, 'The headline'),
  heroText: text(400, 'The introduction'),
  stepsTitle: text(80, 'The steps heading'),
  steps: z.array(copyItem).length(landingStepCount),
  featuresTitle: text(80, 'The features heading'),
  featuresText: text(300, 'The features introduction'),
  features: z.array(copyItem).length(landingFeatureCount),
  exploreTitle: text(80, 'The heading over shows'),
  exploreText: text(300, 'The introduction to shows'),
  ctaTitle: text(80, 'The closing heading'),
  ctaText: text(300, 'The closing text'),
})

// Attributes the analytics script tag may have: data-* (as Umami, Plausible
// and the like are configured) and async/defer.
const attributeName = /^(data-[a-z0-9-]+|async|defer)$/

// "name=value" lines, as admins type them, to attributes. Throws on a bad line.
export function parseAnalyticsAttributes(lines: string) {
  const attributes: Record<string, string> = {}
  for (const line of lines.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [name = '', ...rest] = line.split('=')
    const key = name.trim().toLowerCase()
    if (!attributeName.test(key)) throw new Error(`"${name.trim()}" isn't allowed: use data-… attributes, async or defer`)
    attributes[key] = rest.join('=').trim().replace(/^"(.*)"$/, '$1')
  }
  return attributes
}

export function formatAnalyticsAttributes(attributes: Record<string, string>) {
  return Object.entries(attributes)
    .map(([name, value]) => (value ? `${name}=${value}` : name))
    .join('\n')
}

// What admins save at /admin/branding. A null landing page, legal page or
// analytics URL goes back to the default (or none).
export const brandingSchema = z.object({
  name: text(40, 'The name'),
  tagline: text(80, 'The tagline'),
  description: text(300, 'The description'),
  contactEmail: z.string().trim().pipe(z.email('Enter a valid email address')),
  landing: landingCopySchema.nullable(),
  privacyHtml: z.string().max(100_000).nullable(),
  termsHtml: z.string().max(100_000).nullable(),
  analyticsScriptUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((value) => value || null)
    .refine((value) => value === null || /^https:\/\/[^\s"'<>]+$/.test(value), 'Use an https:// address'),
  analyticsAttributes: z.record(z.string().regex(attributeName, 'Use data-… attributes, async or defer'), z.string().max(500)),
})
export type BrandingInput = z.infer<typeof brandingSchema>

// The theme admins save on the Theme tab, or null for app.css's own.
export const themeSchema = z.object({ theme: siteThemeSchema.nullable() })
