import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { imageSuggestionSchema } from '~/lib/image-search'
import { getSession } from '~/server/auth.server'
import { ImageSuggestionError, suggestImage } from '~/server/image-suggestions.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// A random image suiting the podcast or episode, staged like an upload.
export const suggestArtwork = createServerFn({ method: 'POST' })
  .validator(imageSuggestionSchema)
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, suggestion: await suggestImage(await requireUserId(), data) }
    } catch (error) {
      if (error instanceof ImageSuggestionError) return { ok: false as const, error: error.message }
      throw error
    }
  })
