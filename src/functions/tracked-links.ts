// Server functions for an episode's tracked links (see tracked-links.server.ts).
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createTrackedLinkSchema, deleteTrackedLinkSchema } from '~/lib/tracked-link-schema'
import { getSession } from '~/server/auth.server'
import { createTrackedLink, deleteTrackedLink } from '~/server/tracked-links.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  const userId = session?.user?.id
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

export const createMyTrackedLink = createServerFn({ method: 'POST' })
  .validator(createTrackedLinkSchema)
  .handler(async ({ data }) => createTrackedLink(await requireUserId(), data.episodeId, data.label))

export const deleteMyTrackedLink = createServerFn({ method: 'POST' })
  .validator(deleteTrackedLinkSchema)
  .handler(async ({ data }) => {
    await deleteTrackedLink(await requireUserId(), data.id)
  })
