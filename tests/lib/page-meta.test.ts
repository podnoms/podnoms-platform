import { describe, expect, it } from 'vitest'
import { publicPageHead, siteHead, truncate } from '~/lib/page-meta'

const page = {
  title: 'Show',
  description: '<p>About <b>it</b></p>',
  fallbackDescription: 'A podcast',
  url: 'https://pods.example/podcasts/show',
  type: 'website' as const,
  feedUrl: 'https://pods.example/feed/show',
  feedTitle: 'Show',
  noindex: false,
}

function tags(head: ReturnType<typeof publicPageHead>) {
  return Object.fromEntries(
    head.meta.flatMap((tag) => ('content' in tag ? [['property' in tag ? tag.property : tag.name, tag.content]] : [])),
  )
}

describe('publicPageHead', () => {
  it('describes stored artwork as a large 1200×630 JPEG', () => {
    const image = { url: 'https://pods.example/images/abc.jpg?og', width: 1200, height: 630 }
    expect(tags(publicPageHead({ ...page, image }))).toMatchObject({
      'og:title': 'Show',
      'og:description': 'About it',
      'og:url': 'https://pods.example/podcasts/show',
      'og:image': image.url,
      'og:image:secure_url': image.url,
      'og:image:type': 'image/jpeg',
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:alt': 'Artwork for Show',
      'twitter:card': 'summary_large_image',
    })
  })

  it.each([null, '', '<p> </p>'])('falls back to the default description for %j', (description) => {
    expect(tags(publicPageHead({ ...page, description, image: null }))).toMatchObject({
      description: 'A podcast',
      'og:description': 'A podcast',
    })
  })

  it('gives images of unknown size a small card, without size tags', () => {
    const result = tags(publicPageHead({ ...page, image: { url: 'http://img.example/a.png' } }))
    expect(result).toMatchObject({ 'og:image': 'http://img.example/a.png', 'twitter:card': 'summary' })
    expect(result).not.toHaveProperty('og:image:width')
    expect(result).not.toHaveProperty('og:image:type')
    expect(result).not.toHaveProperty('og:image:secure_url')
  })

  it('falls back to the site card without an image', () => {
    const result = tags(publicPageHead({ ...page, image: null }))
    expect(result).toMatchObject({
      'og:image': 'https://pods.example/og-default.png',
      'og:image:type': 'image/png',
      'og:image:alt': 'podnoms',
      'twitter:card': 'summary_large_image',
    })
  })

  it('names the page with documentTitle, keeping the title for previews', () => {
    const head = publicPageHead({ ...page, image: null, documentTitle: 'Episode – Show' })
    expect(head.meta[0]).toEqual({ title: 'Episode – Show · podnoms' })
    expect(tags(head)['og:title']).toBe('Show')
  })

  it('keeps search descriptions shorter than preview ones', () => {
    const long = `<p>${'word '.repeat(100)}</p>`
    const result = tags(publicPageHead({ ...page, description: long, image: null }))
    expect(result.description!.length).toBeLessThanOrEqual(160)
    expect(result['og:description']!.length).toBeLessThanOrEqual(300)
    expect(result['og:description']!.length).toBeGreaterThan(160)
  })

  it('names the audio and its type', () => {
    const result = tags(publicPageHead({ ...page, image: null, audioUrl: 'https://pods.example/a.mp3' }))
    expect(result).toMatchObject({ 'og:audio': 'https://pods.example/a.mp3', 'og:audio:type': 'audio/mpeg' })
  })
})

describe('siteHead', () => {
  it('gives a site page an absolute canonical URL and the site card', () => {
    const head = siteHead({ origin: 'https://pods.example', path: '/privacy', title: 'Privacy', description: 'About data' })
    expect(head.links).toEqual([{ rel: 'canonical', href: 'https://pods.example/privacy' }])
    expect(tags(head)).toMatchObject({
      description: 'About data',
      'og:url': 'https://pods.example/privacy',
      'og:image': 'https://pods.example/og-default.png',
      'twitter:card': 'summary_large_image',
    })
  })
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Short.', 160)).toBe('Short.')
  })

  it('cuts at a word boundary, marking the cut', () => {
    expect(truncate('one two three four', 12)).toBe('one two…')
  })
})
