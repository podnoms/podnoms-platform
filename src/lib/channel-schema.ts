import { z } from 'zod'
import { channelProviders, parseChannelUrl, parsePlaylistUrl, playlistPlatforms } from '~/lib/platforms'
import { customDomainField } from '~/lib/podcast-schema'

const platformNames = channelProviders.map((provider) => provider.label).join(' or ')

// A podcast made from a channel or playlist: its link, e.g. a YouTube channel.
export const newChannelPodcastSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste a link to the channel or playlist')
    .max(2000)
    .refine(
      (url) => parseChannelUrl(url) !== null || parsePlaylistUrl(url) !== null,
      `That isn't a link to a ${platformNames} channel, or a ${playlistPlatforms} playlist`,
    ),
  customDomain: customDomainField.optional(),
})
export type NewChannelPodcastInput = z.infer<typeof newChannelPodcastSchema>

export const channelEnabledSchema = z.object({ podcastId: z.string().min(1), enabled: z.boolean() })
