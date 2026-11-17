// Only one thing plays at a time, across every tab of the site: when a media
// element starts playing with sound, it says so on a BroadcastChannel and every
// other element registered here pauses, in other tabs (and same-site embeds)
// and in this one (the app's player and the live player, say). Something
// playing muted, such as a live stream the browser wouldn't start with sound,
// is left alone and doesn't count until it's unmuted.

const audible = (media: HTMLMediaElement) => !media.paused && !media.muted && media.volume > 0

const channelName = 'podnoms-playback'

// Registers the element; returns a function that unregisters it.
export function playOneAtATime(media: HTMLMediaElement): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  // One channel per element: a channel doesn't hear its own messages, but
  // does hear other channels' in the same tab.
  const channel = new BroadcastChannel(channelName)
  const announce = () => {
    if (audible(media)) channel.postMessage('playing')
  }
  channel.onmessage = () => {
    if (audible(media)) media.pause()
  }
  media.addEventListener('play', announce)
  media.addEventListener('volumechange', announce)
  return () => {
    media.removeEventListener('play', announce)
    media.removeEventListener('volumechange', announce)
    channel.close()
  }
}
