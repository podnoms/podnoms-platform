import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fontStylesheet, prepareFonts } from '~/server/fonts.server'
import { fontFilePath } from '~/server/storage.server'

// Google's stylesheet for a font, naming two of its files.
const googleCss = `
/* latin-ext */
@font-face { font-family: 'Space Mono'; src: url(https://fonts.gstatic.com/s/spacemono/v1/a.woff2) format('woff2'); }
/* latin */
@font-face { font-family: 'Space Mono'; src: url(https://fonts.gstatic.com/s/spacemono/v1/b.woff2) format('woff2'); }
`

function fakeGoogle(fail = false) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (fail) return new Response('nope', { status: 500 })
    if (url.startsWith('https://fonts.googleapis.com/')) return new Response(googleCss)
    return new Response(new Uint8Array([1, 2, 3]))
  })
}

afterEach(() => vi.restoreAllMocks())

describe('fontStylesheet', () => {
  it("downloads the font once and points its stylesheet at the site's copies", async () => {
    const fetch = fakeGoogle()
    const path = await fontStylesheet('Space Mono')
    expect(fetch.mock.calls[0]![0]).toBe('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap')
    const css = await readFile(path!, 'utf8')
    expect(css).not.toContain('gstatic')
    const files = [...css.matchAll(/\/fonts\/space-mono\/([0-9a-f]{16}\.woff2)/g)].map((match) => match[1]!)
    expect(files).toHaveLength(2)
    expect([...(await readFile(fontFilePath('space-mono', files[0]!)))]).toEqual([1, 2, 3])

    fetch.mockClear()
    expect(await fontStylesheet('Space Mono')).toBe(path)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('downloads a font asked for twice at once only once', async () => {
    const fetch = fakeGoogle()
    await Promise.all([fontStylesheet('Lora'), fontStylesheet('Lora')])
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('https://fonts.googleapis.com/'))).toHaveLength(1)
  })

  it('is null for a font that is not one of the theme fonts, without asking Google', async () => {
    const fetch = fakeGoogle()
    expect(await fontStylesheet('Comic Sans MS')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is null when Google refuses, and tries again next time', async () => {
    fakeGoogle(true)
    expect(await fontStylesheet('Fira Code')).toBeNull()
    vi.restoreAllMocks()
    fakeGoogle()
    expect(await fontStylesheet('Fira Code')).not.toBeNull()
  })
})

describe('prepareFonts', () => {
  it('downloads every font named', async () => {
    fakeGoogle()
    await prepareFonts(['Inter', 'Geist Mono'])
    expect(await readFile(fontFilePath('inter', 'font.css'), 'utf8')).toContain('/fonts/inter/')
    expect(await readFile(fontFilePath('geist-mono', 'font.css'), 'utf8')).toContain('/fonts/geist-mono/')
  })
})
