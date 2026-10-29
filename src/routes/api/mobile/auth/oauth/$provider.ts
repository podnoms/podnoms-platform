import { createFileRoute } from '@tanstack/react-router'
import { mobileOAuthStartSchema } from '~/lib/mobile-schema'
import { oauthProviders } from '~/server/auth.server'
import { isMobileRedirect } from '~/server/mobile-auth.server'

// Opened by the app in a browser to sign in with a provider: a page that
// starts the usual Auth.js sign-in (a form post with its CSRF token, as
// auth-client.ts does), which comes back to oauth/finish and then the app.
export const Route = createFileRoute('/api/mobile/auth/oauth/$provider')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const provider = params.provider as keyof typeof oauthProviders
        if (!Object.hasOwn(oauthProviders, provider) || !oauthProviders[provider]) {
          return new Response('Not found', { status: 404 })
        }
        const parsed = mobileOAuthStartSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!parsed.success || !isMobileRedirect(parsed.data.redirect_uri)) {
          return new Response('Invalid sign-in request', { status: 400 })
        }
        const callbackUrl = `/api/mobile/auth/oauth/finish?${new URLSearchParams(parsed.data)}`
        return new Response(startPage(`/api/auth/signin/${provider}`, callbackUrl), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      },
    },
  },
})

// JSON for inside a <script>, so nothing in it can end the script.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

function startPage(action: string, callbackUrl: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signing in…</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
@media (prefers-color-scheme:dark){body{background:#000;color:#fff}}</style>
</head>
<body>
<p>Signing in…</p>
<script>
(async () => {
  const { csrfToken } = await fetch('/api/auth/csrf').then((r) => r.json())
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = ${scriptJson(action)}
  for (const [name, value] of Object.entries({ csrfToken, callbackUrl: ${scriptJson(callbackUrl)} })) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
})().catch(() => { document.querySelector('p').textContent = "Couldn't start signing in. Close this and try again." })
</script>
</body>
</html>`
}
