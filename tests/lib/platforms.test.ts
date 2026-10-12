import { describe, expect, it } from 'vitest'
import { parseChannelUrl, parsePlaylistUrl, platformOf } from '~/lib/platforms'

describe('platformOf', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://music.youtube.com/watch?v=abc', 'youtube'],
    ['https://m.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.mixcloud.com/someone/a-mix/', 'mixcloud'],
    ['https://soundcloud.com/someone/track', 'soundcloud'],
    ['https://notyoutube.com/watch', 'other'],
    ['https://video.test/watch', 'other'],
    ['not a url', 'other'],
  ])('%s is %s', (url, platform) => {
    expect(platformOf(url)).toBe(platform)
  })
})

describe('parseChannelUrl', () => {
  it.each([
    ['https://www.youtube.com/@someone', 'https://www.youtube.com/@someone/videos'],
    ['https://youtube.com/@someone/streams', 'https://www.youtube.com/@someone/videos'],
    ['https://m.youtube.com/@someone/featured?si=x', 'https://www.youtube.com/@someone/videos'],
    ['https://www.youtube.com/channel/UC123/videos', 'https://www.youtube.com/channel/UC123/videos'],
    ['https://www.youtube.com/c/Someone', 'https://www.youtube.com/c/Someone/videos'],
    ['https://www.youtube.com/user/someone', 'https://www.youtube.com/user/someone/videos'],
  ])('normalises the YouTube channel %s', (url, normalised) => {
    expect(parseChannelUrl(url)).toEqual({ platform: 'youtube', url: normalised })
  })

  it.each([
    ['https://www.mixcloud.com/someone/', 'https://www.mixcloud.com/someone/uploads/'],
    ['https://mixcloud.com/someone', 'https://www.mixcloud.com/someone/uploads/'],
    ['https://www.mixcloud.com/someone/uploads/', 'https://www.mixcloud.com/someone/uploads/'],
  ])('normalises the Mixcloud user %s', (url, normalised) => {
    expect(parseChannelUrl(url)).toEqual({ platform: 'mixcloud', url: normalised })
  })

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/',
    'https://www.youtube.com/channel/',
    'https://youtu.be/abc',
    'https://www.mixcloud.com/someone/a-mix/',
    'https://www.mixcloud.com/someone/playlists/',
    'https://www.mixcloud.com/discover/house/',
    'https://soundcloud.com/someone',
    'ftp://www.youtube.com/@someone',
    'nonsense',
  ])("doesn't take %s as a channel", (url) => {
    expect(parseChannelUrl(url)).toBeNull()
  })
})

describe('parsePlaylistUrl', () => {
  it.each([
    ['https://www.youtube.com/playlist?list=PL123', 'youtube', 'https://www.youtube.com/playlist?list=PL123'],
    ['https://m.youtube.com/watch?v=abc&list=PL123&index=2', 'youtube', 'https://www.youtube.com/playlist?list=PL123'],
    ['https://youtu.be/abc?list=OLAK5uy_x-1', 'youtube', 'https://www.youtube.com/playlist?list=OLAK5uy_x-1'],
    ['https://mixcloud.com/someone/playlists/deep-house', 'mixcloud', 'https://www.mixcloud.com/someone/playlists/deep-house/'],
    ['https://soundcloud.com/someone/sets/best-of?si=x', 'soundcloud', 'https://soundcloud.com/someone/sets/best-of'],
  ])('normalises %s', (url, platform, normalised) => {
    expect(parsePlaylistUrl(url)).toEqual({ platform, url: normalised })
  })

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/@someone',
    'https://www.youtube.com/watch?v=abc&list=RDabc',
    'https://www.youtube.com/playlist?list=WL',
    'https://www.youtube.com/playlist?list=LL',
    'https://www.mixcloud.com/someone/',
    'https://www.mixcloud.com/someone/playlists/',
    'https://soundcloud.com/someone/sets/',
    'https://soundcloud.com/someone/track',
    'https://example.com/playlist?list=PL123',
    'nonsense',
  ])("doesn't take %s as a playlist", (url) => {
    expect(parsePlaylistUrl(url)).toBeNull()
  })
})
