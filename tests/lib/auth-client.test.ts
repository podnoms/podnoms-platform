// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signIn, signOut, updateSession } from '~/lib/auth-client'
import { readLastEpisode, storeLastEpisode } from '~/lib/last-episode'
import { readStoredVolume, storeVolume } from '~/lib/volume'

let submitted: HTMLFormElement[]

beforeEach(() => {
  submitted = []
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ csrfToken: 'token-123' })))
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    submitted.push(this)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function fields(form: HTMLFormElement) {
  return Object.fromEntries([...form.querySelectorAll('input')].map((input) => [input.name, input.value]))
}

describe('signIn', () => {
  it('posts credentials, with the CSRF token, to the credentials callback', async () => {
    await signIn('credentials', { email: 'a@b.co', password: 'secret123' })
    expect(fetch).toHaveBeenCalledWith('/api/auth/csrf')
    const [form] = submitted
    expect(form!.method.toUpperCase()).toBe('POST')
    expect(new URL(form!.action, 'http://x').pathname).toBe('/api/auth/callback/credentials')
    expect(fields(form!)).toEqual({ csrfToken: 'token-123', callbackUrl: '/', email: 'a@b.co', password: 'secret123' })
    expect(form!.isConnected).toBe(true)
  })

  it('starts OAuth sign-in at the provider endpoint', async () => {
    await signIn('github')
    expect(new URL(submitted[0]!.action, 'http://x').pathname).toBe('/api/auth/signin/github')
  })

  it('lets the caller override the callback URL', async () => {
    await signIn('google', { callbackUrl: '/podcasts/x' })
    expect(fields(submitted[0]!).callbackUrl).toBe('/podcasts/x')
  })
})

describe('signOut', () => {
  it('posts to the sign-out endpoint', async () => {
    await signOut()
    expect(new URL(submitted[0]!.action, 'http://x').pathname).toBe('/api/auth/signout')
    expect(fields(submitted[0]!)).toEqual({ csrfToken: 'token-123', callbackUrl: '/' })
  })

  it("forgets the player's episode but keeps the volume", async () => {
    storeLastEpisode({ id: 'e', title: 'T', audioUrl: '/a', imageUrl: null, podcastTitle: 'P', positionSeconds: 3 })
    storeVolume({ level: 0.4, muted: false })
    await signOut()
    expect(readLastEpisode()).toBeNull()
    expect(readStoredVolume()).toEqual({ level: 0.4, muted: false })
  })
})

describe('updateSession', () => {
  it('posts the data as JSON, with the CSRF token, without navigating', async () => {
    await updateSession({ twoFactorTicket: 'ticket' })
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken: 'token-123', data: { twoFactorTicket: 'ticket' } }),
    })
    expect(submitted).toEqual([])
  })

  it('throws if Auth.js refuses the update', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === '/api/auth/csrf' ? Response.json({ csrfToken: 'x' }) : new Response(null, { status: 500 }),
    )
    await expect(updateSession({})).rejects.toThrow('500')
  })
})
