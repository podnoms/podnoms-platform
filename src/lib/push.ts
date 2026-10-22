// The browser's side of desktop notifications: registering the service worker
// (public/push-sw.js) and subscribing it to the site's pushes. The server's
// side is push.server.ts.

const workerUrl = '/push-sw.js'

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// This browser's subscription, if notifications are on in it.
export async function currentPushSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration(workerUrl)
  return (await registration?.pushManager.getSubscription()) ?? null
}

// The server's VAPID public key (base64url) as the bytes PushManager wants.
function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

// Asks for permission and subscribes. Returns the subscription to save on the
// server, or why it couldn't.
export async function subscribeThisBrowser(publicKey: string) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { error: permission === 'denied' ? ('denied' as const) : ('dismissed' as const) }
  const registration = await navigator.serviceWorker.register(workerUrl)
  await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  // One made with other keys (the site's have changed) can't be used.
  const key = keyBytes(publicKey)
  const sameKey =
    existing?.options.applicationServerKey &&
    new Uint8Array(existing.options.applicationServerKey).every((byte, i) => byte === key[i])
  if (existing && !sameKey) await existing.unsubscribe()
  const subscription =
    existing && sameKey ? existing : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  return { subscription: { endpoint: json.endpoint, keys: json.keys } }
}

// Unsubscribes this browser; returns the endpoint it had, for the server to forget.
export async function unsubscribeThisBrowser() {
  const subscription = await currentPushSubscription()
  if (!subscription) return null
  await subscription.unsubscribe()
  return subscription.endpoint
}
