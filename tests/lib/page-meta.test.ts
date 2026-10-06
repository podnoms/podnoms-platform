import { describe, expect, it } from 'vitest'
import { publicPageHead } from '~/lib/page-meta'

const page = {
  title: 'Show',
  description: '<p>About <b>it</b></p>',
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

  it('gives images of unknown size a small card, without size tags', () => {
    const result = tags(publicPageHead({ ...page, image: { url: 'http://img.example/a.png' } }))
    expect(result).toMatchObject({ 'og:image': 'http://img.example/a.png', 'twitter:card': 'summary' })
    expect(result).not.toHaveProperty('og:image:width')
    expect(result).not.toHaveProperty('og:image:type')
    expect(result).not.toHaveProperty('og:image:secure_url')
  })

  it('has no image tags without an image', () => {
    const result = tags(publicPageHead({ ...page, image: null }))
    expect(Object.keys(result).filter((key) => key.startsWith('og:image'))).toEqual([])
    expect(result['twitter:card']).toBe('summary')
  })
})
