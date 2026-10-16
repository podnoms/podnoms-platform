import { afterEach, describe, expect, it, vi } from 'vitest'
import { commons } from '~/server/image-sources/commons.server'
import { ImageSuggestionError, imageSource, suggestImage } from '~/server/image-suggestions.server'
import { stagedImagePath } from '~/server/storage.server'
import { fakeSources, searches } from '../fake-image-sources'
import { exists } from '../helpers'

afterEach(() => vi.unstubAllGlobals())

describe('imageSource', () => {
  it('prefers Pexels, then Flickr, then Wikimedia Commons', () => {
    expect(imageSource({ PEXELS_API_KEY: 'p', FLICKR_API_KEY: 'f' }).name).toBe('pexels')
    expect(imageSource({ FLICKR_API_KEY: 'f' }).name).toBe('flickr')
    expect(imageSource({})).toBe(commons)
  })

  it('is Wikimedia Commons with no keys set', () => {
    expect(imageSource()).toBe(commons)
  })
})

describe('suggestImage', () => {
  it('stages a photo matching the title, with its credit', async () => {
    await fakeSources({ 'deep jazz': ['b1'] })
    const suggestion = await suggestImage('user-1', { title: 'Deep Jazz' }, commons)
    expect(suggestion).toMatchObject({
      imageId: expect.any(String),
      previewUrl: 'https://upload.wikimedia.test/b1/1400px.jpg',
      photoId: 'b1',
      credit: { author: 'Creator b1', source: 'Wikimedia Commons' },
    })
    expect(await exists(stagedImagePath('user-1', suggestion.imageId))).toBe(true)
  })

  it('tries broader searches until one finds something', async () => {
    const fetch = await fakeSources({ sunset: ['c1'] })
    expect((await suggestImage('user-1', { title: 'Muraku Sunset' }, commons)).photoId).toBe('c1')
    expect(searches(fetch)).toEqual(['muraku sunset', 'muraku', 'sunset'])
  })

  it('suggests a different photo each time, then says when it has run out', async () => {
    await fakeSources({ ocean: ['d1', 'd2'] })
    const first = await suggestImage('user-1', { title: 'Ocean' }, commons)
    const second = await suggestImage('user-1', { title: 'Ocean', exclude: [first.photoId] }, commons)
    expect([first.photoId, second.photoId].sort()).toEqual(['d1', 'd2'])
    await expect(suggestImage('user-1', { title: 'Ocean', exclude: ['d1', 'd2'] }, commons)).rejects.toThrow(
      "Couldn't find any more images",
    )
  })

  it('tries another photo when one fails to download', async () => {
    await fakeSources({ desert: ['gone1', 'e2'] }, ['gone1'])
    expect((await suggestImage('user-1', { title: 'Desert' }, commons)).photoId).toBe('e2')
  })

  it('gives up after a few failed downloads', async () => {
    await fakeSources({ canyon: ['gone2', 'gone3', 'gone4', 'f4'] }, ['gone2', 'gone3', 'gone4'])
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await expect(suggestImage('user-1', { title: 'Canyon' }, commons)).rejects.toThrow(ImageSuggestionError)
    } finally {
      random.mockRestore()
    }
  })

  it('says image search is unavailable when the source refuses us', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
    await expect(suggestImage('user-1', { title: 'Glacier' }, commons)).rejects.toThrow("Image search isn't available")
  })

  it('keeps searches for a day, to save the quota', async () => {
    const fetch = await fakeSources({ forest: ['g1', 'g2', 'g3'] })
    await suggestImage('user-1', { title: 'Forest' }, commons)
    await suggestImage('user-1', { title: 'Forest' }, commons)
    expect(searches(fetch)).toEqual(['forest'])
  })
})
