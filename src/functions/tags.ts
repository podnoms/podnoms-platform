import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { episodePageSize } from '~/lib/episode-pages'
import { listPageSchema } from '~/lib/library-schema'
import { getSession } from '~/server/auth.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { countTagEpisodes, getTagBySlug, listTagEpisodes, searchTags } from '~/server/tags.server'
import { withWaveforms } from '~/server/waveforms.server'

const tagPageSchema = z.object({
  tagSlug: z.string().min(1).max(100),
  sort: z.enum(['newest', 'popular']).default('newest'),
})

// The shared vocabulary is available to signed-in owners adding tags.
export const fetchTagSuggestions = createServerFn({ method: 'GET' })
  .validator(z.object({ query: z.string().trim().max(100) }))
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    return searchTags(data.query)
  })

async function taggedEpisodes(tagId: string, sort: 'newest' | 'popular', page: { offset: number; limit: number }) {
  const session = await getSession(getRequest())
  const episodes = await listTagEpisodes(tagId, session?.user?.id ?? null, sort, page)
  return withWaveforms(episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) })))
}

export const fetchTagPage = createServerFn({ method: 'GET' })
  .validator(tagPageSchema)
  .handler(async ({ data }) => {
    const tag = await getTagBySlug(data.tagSlug)
    if (!tag) throw notFound()
    const [episodes, total] = await Promise.all([
      taggedEpisodes(tag.id, data.sort, { offset: 0, limit: episodePageSize }),
      countTagEpisodes(tag.id),
    ])
    return { tag, episodes, total }
  })

export const fetchTagEpisodes = createServerFn({ method: 'GET' })
  .validator(tagPageSchema.extend(listPageSchema.shape))
  .handler(async ({ data }) => {
    const tag = await getTagBySlug(data.tagSlug)
    if (!tag) throw notFound()
    return taggedEpisodes(tag.id, data.sort, data)
  })
