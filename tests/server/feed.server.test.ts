import { beforeEach, describe, expect, it } from 'vitest'
import { buildPodcastFeed, feedPath } from '~/server/feed.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

const origin = 'https://pod.example'

beforeEach(() => resetDb(db))

// Parsing the feed as XML checks it's well formed and makes it easy to query.
async function parseFeed(xml: string) {
  const { Window } = await import('happy-dom')
  const doc = new new Window().DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc
}

const readyEpisode = (values: Parameters<typeof createEpisode>[1] = {}) => ({
  status: 'ready' as const,
  audioUrl: '/api/episodes/x/audio',
  audioSizeBytes: 12345,
  audioMimeType: 'audio/mpeg',
  ...values,
})

describe('feedPath', () => {
  it('is /feed/<slug>', () => {
    expect(feedPath('my-show')).toBe('/feed/my-show')
  })
})

describe('buildPodcastFeed', () => {
  it('returns null for an unknown slug', async () => {
    expect(await buildPodcastFeed('nope', origin)).toBeNull()
  })

  it('describes the podcast with the iTunes tags podcast apps expect', async () => {
    const user = await createUser({ name: 'Ada & Co' })
    await createPodcast(user.id, {
      slug: 'show',
      title: 'The <Show>',
      description: '<p>About &amp; more</p>',
      imageUrl: '/images/art.jpg',
      category: 'Music',
      language: 'en-ie',
      explicit: true,
    })
    const xml = (await buildPodcastFeed('show', origin))!
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    const doc = await parseFeed(xml)
    const channel = doc.querySelector('channel')!
    const text = (name: string) => channel.getElementsByTagName(name)[0]?.textContent
    expect(text('title')).toBe('The <Show>')
    expect(text('link')).toBe(origin)
    expect(text('description')).toBe('<p>About &amp; more</p>')
    expect(text('itunes:summary')).toBe('About & more')
    expect(text('language')).toBe('en-ie')
    expect(text('itunes:author')).toBe('Ada & Co')
    expect(text('itunes:explicit')).toBe('true')
    expect(text('itunes:type')).toBe('episodic')
    expect(channel.getElementsByTagName('itunes:category')[0]!.getAttribute('text')).toBe('Music')
    expect(channel.getElementsByTagName('itunes:image')[0]!.getAttribute('href')).toBe(`${origin}/images/art.jpg`)
    expect(channel.getElementsByTagName('atom:link')[0]!.getAttribute('href')).toBe(`${origin}/feed/show`)
    expect(channel.getElementsByTagName('itunes:block')).toHaveLength(0)
  })

  it('falls back to the title as description when there is none', async () => {
    await createPodcast((await createUser()).id, { slug: 'show', title: 'Title only' })
    const doc = await parseFeed((await buildPodcastFeed('show', origin))!)
    expect(doc.querySelector('channel > description')!.textContent).toBe('Title only')
  })

  it('blocks private podcasts from directories but still serves them', async () => {
    await createPodcast((await createUser()).id, { slug: 'secret', private: true })
    const xml = await buildPodcastFeed('secret', origin)
    expect(xml).toContain('<itunes:block>Yes</itunes:block>')
  })

  it('lists only ready episodes with audio, newest first', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(podcast.id, readyEpisode({ title: 'Older', publishedAt: new Date('2026-01-01T00:00:00Z') }))
    await createEpisode(podcast.id, readyEpisode({ title: 'Newer', publishedAt: new Date('2026-02-01T00:00:00Z') }))
    await createEpisode(podcast.id, { title: 'Pending', status: 'pending' })
    await createEpisode(podcast.id, { title: 'Failed', status: 'failed' })
    await createEpisode(podcast.id, { title: 'Ready, no audio', status: 'ready' })
    const doc = await parseFeed((await buildPodcastFeed('show', origin))!)
    const titles = [...doc.querySelectorAll('item')].map((item) => item.getElementsByTagName('title')[0]!.textContent)
    expect(titles).toEqual(['Newer', 'Older'])
    expect(doc.getElementsByTagName('lastBuildDate')[0]!.textContent).toBe('Sun, 01 Feb 2026 00:00:00 GMT')
  })

  it('describes each episode and its enclosure', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show' })
    const episode = await createEpisode(
      podcast.id,
      readyEpisode({
        title: 'Ep "1"',
        description: '<p>Line<br>two</p>',
        durationSeconds: 3725,
        imageUrl: '/images/ep.jpg',
        publishedAt: new Date('2026-03-04T05:06:07Z'),
      }),
    )
    const doc = await parseFeed((await buildPodcastFeed('show', origin))!)
    const item = doc.querySelector('item')!
    const text = (name: string) => item.getElementsByTagName(name)[0]?.textContent
    expect(text('title')).toBe('Ep "1"')
    expect(text('description')).toBe('<p>Line<br>two</p>')
    expect(text('itunes:summary')).toBe('Line\ntwo')
    expect(text('guid')).toBe(episode.id)
    expect(item.getElementsByTagName('guid')[0]!.getAttribute('isPermaLink')).toBe('false')
    expect(text('pubDate')).toBe('Wed, 04 Mar 2026 05:06:07 GMT')
    expect(text('itunes:duration')).toBe('3725')
    expect(item.getElementsByTagName('itunes:image')[0]!.getAttribute('href')).toBe(`${origin}/images/ep.jpg`)
    const enclosure = item.getElementsByTagName('enclosure')[0]!
    expect(enclosure.getAttribute('url')).toBe(`${origin}/api/episodes/x/audio`)
    expect(enclosure.getAttribute('length')).toBe('12345')
    expect(enclosure.getAttribute('type')).toBe('audio/mpeg')
  })

  it('dates unpublished episodes by when they were created', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(podcast.id, readyEpisode({ createdAt: new Date('2026-05-06T07:08:09Z') }))
    const doc = await parseFeed((await buildPodcastFeed('show', origin))!)
    expect(doc.querySelector('item pubDate')!.textContent).toBe('Wed, 06 May 2026 07:08:09 GMT')
  })

  it("uses an episode's artwork when the podcast has none", async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(podcast.id, readyEpisode({ imageUrl: '/images/ep.jpg' }))
    const doc = await parseFeed((await buildPodcastFeed('show', origin))!)
    expect(doc.querySelector('channel > image > url')!.textContent).toBe(`${origin}/images/ep.jpg`)
  })

  it('keeps absolute artwork URLs as they are', async () => {
    await createPodcast((await createUser()).id, { slug: 'show', imageUrl: 'https://cdn.example/art.jpg' })
    expect(await buildPodcastFeed('show', origin)).toContain('href="https://cdn.example/art.jpg"')
  })

  it('escapes text that would break the XML', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show', title: `A & B's <"show">` })
    await createEpisode(podcast.id, readyEpisode({ title: ']]></title><script>' }))
    const xml = (await buildPodcastFeed('show', origin))!
    expect(xml).not.toContain('<script>')
    const doc = await parseFeed(xml)
    expect(doc.querySelector('channel > title')!.textContent).toBe(`A & B's <"show">`)
    expect(doc.querySelector('item > title')!.textContent).toBe(']]></title><script>')
  })
})
