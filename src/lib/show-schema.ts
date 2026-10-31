import { z } from 'zod'
import { normalizeDomain } from '~/lib/custom-domain'
import { reservedShowSlugs } from '~/lib/paths'
import { tagNamesSchema } from '~/lib/tag-schema'
import {
  categoryNames,
  directoryIds,
  isDirectoryListing,
  isSubcategoryOf,
  showLanguages,
  type AppleCategory,
  type DirectoryId,
} from '~/lib/podcast-directories'

// The owner's own domain for a show, as typed or pasted: normalised to a
// host name such as "pod.example.com", or null when left empty.
export const customDomainField = z
  .string()
  .max(300)
  .nullable()
  .transform((value, context) => {
    if (!value?.trim()) return null
    const domain = normalizeDomain(value)
    if (!domain) {
      context.addIssue({ code: 'custom', message: 'Enter a domain such as pod.example.com' })
      return z.NEVER
    }
    return domain
  })

export const newShowSchema = z.object({
  title: z.string().trim().min(1, 'Give your show a title').max(100, 'Keep the title under 100 characters'),
  description: z
    .string()
    .trim()
    .max(4000, 'Keep the description under 4000 characters')
    .transform((value) => value || undefined)
    .optional(),
  customDomain: customDomainField.optional(),
  tags: tagNamesSchema.optional(),
})
export type NewShowInput = z.infer<typeof newShowSchema>

// Descriptions are HTML from the rich text editor, sanitised on the server.
export const descriptionHtml = z.string().max(20000, 'That description is too long').optional()

// The image field of an edit form: an uploaded image's ID (see /api/images) to
// use, null to remove the image, or left out to keep it.
export const imageChange = z.uuid().nullable().optional()

// A show's slug, which its page and feed are addressed by (/<slug>).
export const showSlugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Give your show an address')
  .max(60, 'Keep the address under 60 characters')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use only letters, numbers and single hyphens between them')
  .refine((slug) => !reservedShowSlugs.has(slug), "That address is one of the site's own pages")

export const editShowSchema = z.object({
  id: z.string().min(1),
  title: newShowSchema.shape.title,
  // Left out to keep it.
  slug: showSlugField.optional(),
  description: descriptionHtml,
  imageId: imageChange,
  tags: tagNamesSchema.optional(),
})
export type EditShowInput = z.infer<typeof editShowSchema>

// What directories need to know about a show, set on its Distribution tab.
export const directoryDetailsSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(categoryNames as [AppleCategory, ...AppleCategory[]], 'Choose a category'),
    subcategory: z.string().trim().max(100).nullable().transform((value) => value || null),
    language: z.enum(showLanguages, 'Choose a language'),
    explicit: z.boolean(),
    author: z.string().trim().min(1, 'Say who makes the show').max(255),
    ownerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .nullable()
      .transform((value) => value || null)
      .pipe(z.email('Enter a valid email address').nullable()),
  })
  .refine((input) => !input.subcategory || isSubcategoryOf(input.category, input.subcategory), {
    message: "That subcategory isn't in the category chosen",
    path: ['subcategory'],
  })
export type DirectoryDetailsInput = z.infer<typeof directoryDetailsSchema>

// The show's listing on each directory: a page on that directory's site, or
// empty to forget it.
export const directoryLinkSchema = z
  .object({
    id: z.string().min(1),
    directory: z.enum(directoryIds as [DirectoryId, ...DirectoryId[]]),
    link: z.string().trim().max(500),
  })
  .refine((input) => !input.link || isDirectoryListing(input.directory, input.link), {
    message: "That isn't a link to a listing on that directory",
    path: ['link'],
  })
export type DirectoryLinkInput = z.infer<typeof directoryLinkSchema>

// Setting (or, with an empty domain, removing) a show's own domain.
export const customDomainSchema = z.object({
  id: z.string().min(1),
  domain: customDomainField,
})
export type CustomDomainInput = z.infer<typeof customDomainSchema>
