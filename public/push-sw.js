// Shows podnoms's desktop notifications (see src/server/push.server.ts), and
// opens the page a notification is about when it's clicked. Registered from
// the notification settings (src/lib/push.ts); it does nothing else, so pages
// load just as they would without it.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  if (!event.data) return
  let message
  try {
    message = event.data.json()
  } catch {
    return
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: message.icon || '/android-chrome-192x192.png',
      badge: '/android-chrome-192x192.png',
      tag: message.tag,
      data: { url: message.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => client.url === url)
      if (open) return open.focus()
      // Reuse a podnoms tab if there is one, else open a new one.
      const tab = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (tab && 'navigate' in tab) return (await tab.navigate(url))?.focus()
      return self.clients.openWindow(url)
    })(),
  )
})
