// Browser helpers for the Auth.js endpoints under /api/auth. Each one submits
// a real form so Auth.js can answer with its normal redirects.
import { storeLastEpisode } from '~/lib/last-episode'

export type AuthProvider = 'credentials' | 'github' | 'google' | 'facebook'

async function csrfToken() {
  const { csrfToken } = (await fetch('/api/auth/csrf').then((r) => r.json())) as { csrfToken: string }
  return csrfToken
}

async function postToAuth(path: string, fields: Record<string, string>) {
  const token = await csrfToken()
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `/api/auth/${path}`
  for (const [name, value] of Object.entries({ csrfToken: token, callbackUrl: '/', ...fields })) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
}

export function signIn(provider: AuthProvider, fields: Record<string, string> = {}) {
  return postToAuth(provider === 'credentials' ? 'callback/credentials' : `signin/${provider}`, fields)
}

// Also forgets the episode queued in the player, so the next person to sign in
// on this browser doesn't see it. The volume is left, as it's about the device.
export function signOut() {
  storeLastEpisode(null)
  return postToAuth('signout', {})
}

// Updates the session in place, without navigating. Auth.js passes `data` to
// the jwt callback in auth.server.ts.
export async function updateSession(data: Record<string, unknown>) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csrfToken: await csrfToken(), data }),
  })
  if (!response.ok) throw new Error(`Updating the session failed (${response.status})`)
}
