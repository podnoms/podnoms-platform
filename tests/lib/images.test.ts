import { describe, expect, it } from 'vitest'
import { imageSrc, openGraphImage } from '~/lib/images'

describe('imageSrc', () => {
  it('asks for stored images at twice the display width', () => {
    expect(imageSrc('/images/abc.jpg', 128)).toBe('/images/abc.jpg?w=256')
  })

  it('leaves other URLs alone', () => {
    expect(imageSrc('https://i.ytimg.com/vi/x/hq.jpg', 128)).toBe('https://i.ytimg.com/vi/x/hq.jpg')
  })
})

describe('openGraphImage', () => {
  it('asks for the link preview copy of stored images, with its size', () => {
    expect(openGraphImage('/images/abc.jpg')).toEqual({ url: '/images/abc.jpg?og', width: 1200, height: 630 })
  })

  it('leaves other URLs alone, without a size', () => {
    expect(openGraphImage('https://i.ytimg.com/vi/x/hq.jpg')).toEqual({ url: 'https://i.ytimg.com/vi/x/hq.jpg' })
  })
})
