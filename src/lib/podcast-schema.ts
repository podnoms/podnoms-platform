import { z } from 'zod'
import {
  categoryNames,
  directoryIds,
  isDirectoryListing,
  isSubcategoryOf,
  podcastLanguages,
  type AppleCategory,
  type DirectoryId,
} from '~/lib/podcast-directories'

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

// What directories need to know about a podcast, set on its Distribution tab.
export const directoryDetailsSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(categoryNames as [AppleCategory, ...AppleCategory[]], 'Choose a category'),
    subcategory: z.string().trim().max(100).nullable().transform((value) => value || null),
    language: z.enum(podcastLanguages, 'Choose a language'),
    explicit: z.boolean(),
    author: z.string().trim().min(1, 'Say who makes the podcast').max(255),
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

// The podcast's listing on each directory: a page on that directory's site, or
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
