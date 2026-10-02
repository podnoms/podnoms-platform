import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { searchSchema } from '~/lib/search-schema'
import { getSession } from '~/server/auth.server'
import { searchLibrary } from '~/server/search.server'

// The signed-in user's podcasts and episodes matching a search.
export const searchMyLibrary = createServerFn({ method: 'GET' })
  .validator(searchSchema)
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    return searchLibrary(session.user.id, data.query)
  })
