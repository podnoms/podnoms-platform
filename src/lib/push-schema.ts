import { z } from 'zod'

// A browser's Web Push subscription, as PushSubscription.toJSON() gives it.
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
})

// One of the user's browsers: by id from the settings page's list, or by
// endpoint from the browser itself.
export const removePushSubscriptionSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ endpoint: z.url().max(2000) }),
])

// Which desktop notifications the user gets about the shows they follow.
export const pushPrefsSchema = z.object({
  pushLive: z.boolean(),
  pushNewEpisodes: z.boolean(),
  pushMentions: z.boolean(),
})
