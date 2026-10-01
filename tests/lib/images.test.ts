import { describe, expect, it } from 'vitest'
import { imageSrc } from '~/lib/images'

describe('imageSrc', () => {
  it('asks for stored images at twice the display width', () => {
    expect(imageSrc('/images/abc.jpg', 128)).toBe('/images/abc.jpg?w=256')
  })

  it('leaves other URLs alone', () => {
    expect(imageSrc('https://i.ytimg.com/vi/x/hq.jpg', 128)).toBe('https://i.ytimg.com/vi/x/hq.jpg')
  })
})
