import { z } from 'zod'
import { channelProviders, parseChannelUrl } from '~/lib/platforms'

const platformNames = channelProviders.map((provider) => provider.label).join(' or ')

// A podcast made from a channel: its link, e.g. a YouTube channel.
export const newChannelPodcastSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste a link to the channel')
    .max(2000)
    .refine((url) => parseChannelUrl(url) !== null, `That isn't a link to a ${platformNames} channel`),
})
export type NewChannelPodcastInput = z.infer<typeof newChannelPodcastSchema>

export const channelEnabledSchema = z.object({ podcastId: z.string().min(1), enabled: z.boolean() })
