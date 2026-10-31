import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { episodePageSchema, episodePageSize } from '~/lib/episode-pages'
import { bulkUploadEpisodesSchema, editEpisodeSchema, linkLookupSchema, newEpisodeSchema, replaceAudioSchema } from '~/lib/episode-schema'
import { shortPath, trackedSharePath } from '~/lib/paths'
import { mentionsAsText } from '~/lib/user-slug'
import {
  customDomainSchema,
  directoryDetailsSchema,
  directoryLinkSchema,
  editShowSchema,
  newShowSchema,
} from '~/lib/show-schema'
import { getSession } from '~/server/auth.server'
import { getOpenBroadcast, liveEnabled } from '~/server/live.server'
import { publicUrl } from '~/server/site-url.server'
import { getShowChannel } from '~/server/channels.server'
import { listComments } from '~/server/comments.server'
import {
  catchDomainError,
  customDomainTarget,
  customDomainTxtLabel,
  setCustomDomain,
  verifyCustomDomain,
} from '~/server/custom-domains.server'
import { getDirectoryReadiness, podcastIndexConfigured, submitToPodcastIndex } from '~/server/directories.server'
import { getEpisodeProgress, resumeUnfinishedEpisodes } from '~/server/episode-processor.server'
import { feedPath } from '~/server/feed.server'
import { localiseRemoteImages } from '~/server/images.server'
import { countFollowers } from '~/server/library.server'
import { lookUpLink } from '~/server/link-details.server'
import {
  createEpisode,
  createUploadedEpisodes,
  deleteEpisode,
  deleteShow,
  dismissEpisodeError,
  getEpisode,
  getEpisodeSlug,
  listEpisodes,
  replaceEpisodeAudio,
  retryEpisode,
  savePlaybackPosition,
  setEpisodePrivacy,
  summariseEpisodes,
  updateEpisode,
} from '~/server/episodes.server'
import {
  createShow,
  getShowBySlug,
  listShows,
  resetFeedKey,
  setShowPrivacy,
  updateDirectoryDetails,
  updateDirectoryLink,
  ShowSlugError,
  updateShow,
} from '~/server/shows.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { getProfile } from '~/server/users.server'
import { listTrackedLinks } from '~/server/tracked-links.server'
import { getEpisodeTags, getShowTags } from '~/server/tags-store.server'
import { backfillWaveforms, readWaveform } from '~/server/waveforms.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// The signed-in user's shows, for the sidebar and home page.
export const fetchMyShows = createServerFn({ method: 'GET' }).handler(async () =>
  listShows(await requireUserId()),
)

export const fetchMyShow = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const show = await getShowBySlug(userId, data.slug)
    if (!show) throw notFound()
    void resumeUnfinishedEpisodes()
    void localiseRemoteImages()
    void backfillWaveforms()
    const [episodes, summary, channel, readiness, profile, followerCount, broadcast, tags] = await Promise.all([
      listEpisodes(userId, show.id, { offset: 0, limit: episodePageSize }),
      summariseEpisodes(show.id),
      getShowChannel(show.id),
      getDirectoryReadiness(userId, show.id),
      getProfile(userId),
      countFollowers(show.id),
      liveEnabled() ? getOpenBroadcast(show.id) : null,
      getShowTags(show.id),
    ])
    // The stream key is only read in the Go live dialog.
    const { liveKey: _liveKey, ...details } = show
    return {
      ...details,
      tags,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(show.description),
      // A private show's carries its feed key, for its owner to hand out.
      feedUrl: new URL(feedPath(show.slug, show.private ? show.feedKey : null), publicUrl(getRequest())).toString(),
      episodes: episodes.map((episode) => ({ ...episode, progress: getEpisodeProgress(episode.id) })),
      summary,
      followerCount,
      // The channel the show follows, if it follows one.
      channel,
      // For the Distribution tab: what directories still need, the name and
      // email to suggest, and whether Podcast Index can be submitted to here.
      distribution: {
        readiness: readiness ?? [],
        accountName: profile?.name ?? null,
        accountEmail: profile?.email ?? null,
        podcastIndexAvailable: podcastIndexConfigured(),
      },
      // Where owners point their domain's CNAME; null when custom domains are off.
      customDomainTarget: customDomainTarget(),
      // What the domain's TXT record is named after.
      customDomainTxtLabel: customDomainTxtLabel(),
      // Whether the Go live button is offered (MediaMTX is set up), and whether it's
      // broadcasting now.
      liveEnabled: liveEnabled(),
      live: broadcast !== null,
    }
  })

// More of one of the user's show's episodes, for its management page.
export const fetchMyShowEpisodes = createServerFn({ method: 'GET' })
  .validator(episodePageSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const show = await getShowBySlug(userId, data.slug)
    if (!show) throw notFound()
    const episodes = await listEpisodes(userId, show.id, data)
    return episodes.map((episode) => ({ ...episode, progress: getEpisodeProgress(episode.id) }))
  })

// An episode's page: the episode, its show and its waveform (null until made).
export const fetchMyEpisode = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string(), episodeSlug: z.string() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const found = await getEpisode(userId, data.slug, data.episodeSlug)
    if (!found) throw notFound()
    const { episode, show } = found
    const [waveform, trackedLinks, episodeTags, showTags, comments] = await Promise.all([
      episode.status === 'ready' ? readWaveform(episode.id) : null,
      listTrackedLinks(userId, episode.id),
      getEpisodeTags(episode.id),
      getShowTags(show.id),
      // Shown on its public page; here, marked on the waveform and counted.
      episode.status === 'ready' ? listComments(episode.id, userId) : [],
    ])
    const site = publicUrl(getRequest())
    return {
      show: { ...show, tags: showTags },
      episode: {
        ...episode,
        tags: episodeTags,
        // Sanitised when saved; again here, as it's rendered as HTML.
        description: sanitizeDescription(episode.description),
        progress: getEpisodeProgress(episode.id),
      },
      // The smoother of the two shapes, as Mixcloud draws them.
      waveform: waveform?.rms ?? null,
      comments: comments.map((comment) => ({
        id: comment.id,
        atSeconds: comment.atSeconds,
        author: comment.author,
        text: mentionsAsText(comment.body, comment.mentions) || 'GIF',
      })),
      commentCount: comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0),
      // The short link to the standalone page listeners are sent to; only
      // reachable once the episode's ready.
      shortUrl: new URL(shortPath(episode.shortSlug), site).toString(),
      // Short links made for particular people, to see whether they opened them.
      trackedLinks: trackedLinks.map(({ token, ...link }) => ({
        ...link,
        url: new URL(trackedSharePath(episode.shortSlug, token), site).toString(),
      })),
    }
  })

// An episode's current slug, which changes once when a link's title is fetched.
export const fetchMyEpisodeSlug = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const slug = await getEpisodeSlug(await requireUserId(), data.id)
    if (!slug) throw notFound()
    return slug
  })

export const createMyShow = createServerFn({ method: 'POST' })
  .validator(newShowSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return catchDomainError(() => createShow(userId, data))
  })

export const updateMyShow = createServerFn({ method: 'POST' })
  .validator(editShowSchema)
  .handler(async ({ data }) => {
    try {
      if (!(await updateShow(await requireUserId(), data))) throw notFound()
      return {}
    } catch (error) {
      if (error instanceof ShowSlugError) return { error: error.message }
      throw error
    }
  })

// Deletes one of the user's shows, with all its episodes.
export const deleteMyShow = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const result = await deleteShow(await requireUserId(), data.id)
    if (!result) throw notFound()
    if (result === 'busy') {
      throw new Error('Some episodes are still downloading or having their audio replaced. Try again once they finish.')
    }
  })

export const setMyShowPrivacy = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), private: z.boolean() }))
  .handler(async ({ data }) => {
    if (!(await setShowPrivacy(await requireUserId(), data.id, data.private))) throw notFound()
  })

// Gives a private show a new feed URL, cutting off everyone with the old one.
export const resetMyFeedKey = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await resetFeedKey(await requireUserId(), data.id))) throw notFound()
  })

export const saveDirectoryDetails = createServerFn({ method: 'POST' })
  .validator(directoryDetailsSchema)
  .handler(async ({ data }) => {
    if (!(await updateDirectoryDetails(await requireUserId(), data))) throw notFound()
  })

export const saveDirectoryLink = createServerFn({ method: 'POST' })
  .validator(directoryLinkSchema)
  .handler(async ({ data }) => {
    if (!(await updateDirectoryLink(await requireUserId(), data))) throw notFound()
  })

export const saveCustomDomain = createServerFn({ method: 'POST' })
  .validator(customDomainSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const result = await catchDomainError(() => setCustomDomain(userId, data.id, data.domain))
    if ('value' in result && !result.value) throw notFound()
    return 'error' in result ? { error: result.error } : {}
  })

// Checks the show's domain's DNS records now, verifying it if they're right.
export const testCustomDomain = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const result = await verifyCustomDomain(await requireUserId(), data.id)
    if (!result) throw notFound()
    return result
  })

export const submitMyShowToIndex = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) =>
    submitToPodcastIndex(await requireUserId(), data.id, publicUrl(getRequest()).origin),
  )

export const createMyEpisode = createServerFn({ method: 'POST' })
  .validator(newEpisodeSchema)
  .handler(async ({ data }) => {
    const episode = await createEpisode(await requireUserId(), data)
    if (!episode) throw notFound()
    return episode
  })

// What a pasted link says about itself, to fill in the new episode form.
export const lookUpEpisodeLink = createServerFn({ method: 'POST' })
  .validator(linkLookupSchema)
  .handler(async ({ data }) => lookUpLink(await requireUserId(), data.sourceUrl))

export const createMyEpisodes = createServerFn({ method: 'POST' })
  .validator(bulkUploadEpisodesSchema)
  .handler(async ({ data }) => {
    const created = await createUploadedEpisodes(await requireUserId(), data)
    if (!created) throw notFound()
    return created
  })

export const deleteMyEpisode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!(await deleteEpisode(await requireUserId(), data.id))) throw notFound()
  })

export const updateMyEpisode = createServerFn({ method: 'POST' })
  .validator(editEpisodeSchema)
  .handler(async ({ data }) => {
    if (!(await updateEpisode(await requireUserId(), data))) throw notFound()
  })

export const setMyEpisodePrivacy = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1), private: z.boolean() }))
  .handler(async ({ data }) => {
    if (!(await setEpisodePrivacy(await requireUserId(), data.id, data.private))) throw notFound()
  })

export const retryMyEpisode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!(await retryEpisode(await requireUserId(), data.id))) throw notFound()
  })

export const replaceMyEpisodeAudio = createServerFn({ method: 'POST' })
  .validator(replaceAudioSchema)
  .handler(async ({ data }) => {
    if (!(await replaceEpisodeAudio(await requireUserId(), data))) throw notFound()
  })

export const dismissMyEpisodeError = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!(await dismissEpisodeError(await requireUserId(), data.id))) throw notFound()
  })

export const saveMyPlaybackPosition = createServerFn({ method: 'POST' })
  .validator(z.object({ episodeId: z.string(), seconds: z.number().min(0) }))
  .handler(async ({ data }) => {
    if (!(await savePlaybackPosition(await requireUserId(), data.episodeId, data.seconds))) throw notFound()
  })
