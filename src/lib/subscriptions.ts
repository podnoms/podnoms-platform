// What a subscription gets, for the pages that offer one. The rules are in
// subscriptions.server.ts.
export const paidGraceDays = 14

export const paidPlanName = 'Pro'

// How much audio an account without paid features can have, across all its
// shows. Audio that's already there stays, whatever happens.
export const freeAudioHours = 10

export const paidFeatures = {
  audio: { title: 'Unlimited audio', description: `No limit on how many hours of episodes you keep, rather than ${freeAudioHours} hours in total.` },
  live: { title: 'Live broadcasts', description: 'Go live from OBS with chat for your listeners, and keep each recording as an episode.' },
  customDomain: { title: 'Custom domains', description: 'Put your show and its feed on your own web address.' },
  channels: { title: 'Channels and playlists', description: 'Follow a channel or playlist, and new uploads become episodes by themselves.' },
  privateShows: { title: 'Private shows', description: 'Keep a show to yourself and the people you give its private feed to.' },
  trackedLinks: { title: 'Tracked links', description: 'See whether the people you send an episode to open it and press play.' },
} as const

// What everyone gets without subscribing.
export const freeFeatures = [
  `${freeAudioHours} hours of audio`,
  'Episodes from links and uploads',
  'A podcast feed for every show',
  'Listening stats',
  'Comments, likes and playlists',
]

export type PaidFeature = keyof typeof paidFeatures
