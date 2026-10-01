// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signIn, signOut } from '~/lib/auth-client'

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
})
