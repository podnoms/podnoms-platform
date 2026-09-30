// Browser helpers for the Auth.js endpoints under /api/auth. Each one submits
// a real form so Auth.js can answer with its normal redirects.
export type AuthProvider = 'credentials' | 'github' | 'google' | 'facebook'

async function postToAuth(path: string, fields: Record<string, string>) {
  const { csrfToken } = (await fetch('/api/auth/csrf').then((r) => r.json())) as { csrfToken: string }
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `/api/auth/${path}`
  for (const [name, value] of Object.entries({ csrfToken, callbackUrl: '/', ...fields })) {
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

export function signOut() {
  return postToAuth('signout', {})
}
