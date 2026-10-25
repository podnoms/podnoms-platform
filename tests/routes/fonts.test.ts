import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route } from '~/routes/fonts.$family.$file'
import { callRoute } from '../helpers'

const get = (family: string, file: string) =>
  callRoute(Route, 'GET', new Request(`http://localhost/fonts/${family}/${file}`), { family, file })

afterEach(() => vi.restoreAllMocks())

describe('GET /fonts/$family/$file', () => {
  it("serves a theme font's stylesheet and files from the site's copies", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).startsWith('https://fonts.googleapis.com/')
        ? new Response("@font-face { src: url(https://fonts.gstatic.com/s/dmsans/a.woff2) format('woff2'); }")
        : new Response(new Uint8Array([7])),
    )
    const css = await get('dm-sans', 'font.css')
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    const file = /\/fonts\/dm-sans\/([0-9a-f]{16}\.woff2)/.exec(await css.text())![1]!
    const font = await get('dm-sans', file)
    expect(font.headers.get('content-type')).toBe('font/woff2')
    expect(font.headers.get('cache-control')).toContain('immutable')
    expect([...new Uint8Array(await font.arrayBuffer())]).toEqual([7])
  })

  it('knows only the theme fonts and their files', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect((await get('comic-sans', 'font.css')).status).toBe(404)
    expect((await get('inter', '../../etc.woff2')).status).toBe(404)
    expect((await get('inter', '0123456789abcdef.woff2')).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("says so, without caching, when the font can't be had", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 503 }))
    const response = await get('oxanium', 'font.css')
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
