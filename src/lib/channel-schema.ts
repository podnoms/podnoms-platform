import { z } from 'zod'
import { channelProviders, parseChannelUrl, parsePlaylistUrl, playlistPlatforms } from '~/lib/platforms'
import { customDomainField } from '~/lib/podcast-schema'

const platformNames = channelProviders.map((provider) => provider.label).join(' or ')

// A podcast made from a channel: its link, e.g. a YouTube channel.
export const newChannelPodcastSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste a link to the channel')
    .max(2000)
    .refine((url) => parseChannelUrl(url) !== null, `That isn't a link to a ${platformNames} channel`),
  customDomain: customDomainField.optional(),
})
export type NewChannelPodcastInput = z.infer<typeof newChannelPodcastSchema>

// A podcast made from every item in a playlist (admins only).
export const newPlaylistPodcastSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste a link to the playlist')
    .max(2000)
    .refine((url) => parsePlaylistUrl(url) !== null, `That isn't a link to a ${playlistPlatforms} playlist`),
  customDomain: customDomainField.optional(),
})
export type NewPlaylistPodcastInput = z.infer<typeof newPlaylistPodcastSchema>

export const channelEnabledSchema = z.object({ podcastId: z.string().min(1), enabled: z.boolean() })
