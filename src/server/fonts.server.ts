// The site's own copies of the theme's Google Fonts (see theme-fonts.ts):
// each is downloaded from Google once, into MEDIA_DIR/fonts/<slug>, with its
// stylesheet rewritten to point at the copies, so visitors' browsers never
// contact Google. Served by /fonts/$family/$file.
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { fontSlug, googleFontCssUrl, isGoogleFont } from '~/lib/theme-fonts'
import { reportError } from '~/server/logger.server'
import { ensureFontDir, fontFilePath } from '~/server/storage.server'

// Google sends WOFF2, the smallest format, only to browsers it knows take it.
const browserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const downloads = new Map<string, Promise<void>>()

// The path of the font's stylesheet, downloading the font first if it isn't
// here yet; null if it isn't one of the theme fonts, or can't be downloaded.
export async function fontStylesheet(name: string) {
  if (!isGoogleFont(name)) return null
  const slug = fontSlug(name)
  const css = fontFilePath(slug, 'font.css')
  if (existsSync(css)) return css
  let download = downloads.get(slug)
  if (!download) {
    download = downloadFont(name).finally(() => downloads.delete(slug))
    downloads.set(slug, download)
  }
  try {
    await download
    return css
  } catch (error) {
    reportError(error, { msg: 'Could not download a theme font', font: name })
    return null
  }
}

// Downloads every font the theme names, for it to be ready when saved.
export async function prepareFonts(names: string[]) {
  await Promise.all(names.map((name) => fontStylesheet(name)))
}

async function fetchOk(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': browserAgent }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

async function downloadFont(name: string) {
  const slug = fontSlug(name)
  await ensureFontDir(slug)
  let css = await (await fetchOk(googleFontCssUrl(name))).text()
  // Only files from Google's font host, each named after where it came from.
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) ?? [])]
  if (urls.length === 0) throw new Error(`No font files for ${name}`)
  await Promise.all(
    urls.map(async (url) => {
      const file = `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.woff2`
      const path = fontFilePath(slug, file)
      if (!existsSync(path)) await writeAside(path, Buffer.from(await (await fetchOk(url)).arrayBuffer()))
      css = css.replaceAll(url, `/fonts/${slug}/${file}`)
    }),
  )
  // Written last, as the sign the font is all here.
  await writeAside(fontFilePath(slug, 'font.css'), css)
}

// Written aside then moved, so a request meanwhile never reads half a file.
async function writeAside(path: string, data: string | Buffer) {
  const partial = `${path}.${crypto.randomUUID()}.partial`
  await writeFile(partial, data)
  await rename(partial, path)
}
