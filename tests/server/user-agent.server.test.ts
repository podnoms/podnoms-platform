import { describe, expect, it } from 'vitest'
import { describeUserAgent, isBot } from '~/server/user-agent.server'

describe('describeUserAgent', () => {
  it.each([
    ['AppleCoreMedia/1.0.0.21E236 (iPhone; U; CPU OS 17_4 like Mac OS X; en_us)', 'Apple (system player)', 'iOS', 'phone'],
    ['Podcasts/1650.20 CFNetwork/1494.0.7 Darwin/23.4.0', 'Apple Podcasts', 'iOS', 'phone'],
    ['Overcast/3.0 (+http://overcast.fm/; iOS podcast app)', 'Overcast', 'iOS', 'phone'],
    ['Pocket Casts', 'Pocket Casts', null, null],
    ['Spotify/8.9.10 Android/34 (Pixel 8)', 'Spotify', 'Android', 'phone'],
    ['AntennaPod/3.4.0', 'AntennaPod', null, null],
    ['AlexaMediaPlayer/2.1.4676.0 (Linux;Android 5.1.1) ExoPlayerLib/1.5.9', 'Alexa', 'Android', 'speaker'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'Windows',
      'desktop',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Safari',
      'macOS',
      'desktop',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox', 'Windows', 'desktop'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge',
      'Windows',
      'desktop',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
      'tablet',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'Android',
      'tablet',
    ],
  ])('names %s', (userAgent, client, os, device) => {
    expect(describeUserAgent(userAgent)).toEqual({ client, os, device })
  })

  it('leaves what it does not know as null', () => {
    expect(describeUserAgent('SomethingNew/1.0')).toEqual({ client: null, os: null, device: null })
    expect(describeUserAgent(null)).toEqual({ client: null, os: null, device: null })
  })
})

describe('isBot', () => {
  it('spots crawlers and requests without a user agent', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isBot(null)).toBe(true)
    expect(isBot('')).toBe(true)
  })

  it('spots command-line fetchers', () => {
    expect(isBot('curl/8.7.1')).toBe(true)
    expect(isBot('Wget/1.21.4')).toBe(true)
  })

  it('lets listeners through, podcast apps with URLs in their user agents included', () => {
    expect(isBot('Overcast/3.0 (+http://overcast.fm/; iOS podcast app)')).toBe(false)
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(false)
  })
})
