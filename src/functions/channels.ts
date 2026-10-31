import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { channelEnabledSchema, newChannelShowSchema } from '~/lib/channel-schema'
import { getSession } from '~/server/auth.server'
import { checkChannelNow, createChannelShow, setChannelEnabled } from '~/server/channels.server'
import { catchDomainError } from '~/server/custom-domains.server'
import { getChannelEpisodeLimit } from '~/server/users.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// How many of a channel's uploads the user's shows import, for the form.
export const fetchMyChannelLimit = createServerFn({ method: 'GET' }).handler(async () =>
  getChannelEpisodeLimit(await requireUserId()),
)

export const createMyChannelShow = createServerFn({ method: 'POST' })
  .validator(newChannelShowSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return catchDomainError(() => createChannelShow(userId, data))
  })

export const checkMyChannelNow = createServerFn({ method: 'POST' })
  .validator(z.object({ showId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const result = await checkChannelNow(await requireUserId(), data.showId)
    if (!result) throw notFound()
    return result
  })

export const setMyChannelEnabled = createServerFn({ method: 'POST' })
  .validator(channelEnabledSchema)
  .handler(async ({ data }) => {
    if (!(await setChannelEnabled(await requireUserId(), data.showId, data.enabled))) throw notFound()
  })
