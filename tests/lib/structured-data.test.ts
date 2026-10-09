import { describe, expect, it } from 'vitest'
import { isoDuration, podcastEpisodeJsonLd, podcastSeriesJsonLd, websiteJsonLd } from '~/lib/structured-data'

describe('isoDuration', () => {
  it.each([
    [0, 'PT0S'],
    [45, 'PT45S'],
    [60, 'PT1M'],
    [3725, 'PT1H2M5S'],
    [7200, 'PT2H'],
  ])('%i seconds is %s', (seconds, expected) => {
    expect(isoDuration(seconds)).toBe(expected)
  })
})

describe('podcastSeriesJsonLd', () => {
  it('describes the podcast in plain text', () => {
    expect(
      podcastSeriesJsonLd({
        title: 'Show',
        description: '<p>About <b>it</b></p>',
        pageUrl: 'https://pods.example/podcasts/show',
        feedUrl: 'https://pods.example/feed/show',
        image: 'https://pods.example/images/a.jpg?og',
        author: 'Ann',
        category: 'Music',
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'PodcastSeries',
      name: 'Show',
      description: 'About it',
      url: 'https://pods.example/podcasts/show',
      webFeed: 'https://pods.example/feed/show',
      image: 'https://pods.example/images/a.jpg?og',
      author: { '@type': 'Person', name: 'Ann' },
      genre: 'Music',
    })
  })

  it('links its directory listings', () => {
    const data = podcastSeriesJsonLd({
      title: 'Show',
      description: null,
      pageUrl: 'https://pods.example/podcasts/show',
      feedUrl: 'https://pods.example/feed/show',
      image: null,
      author: null,
      category: null,
      listings: ['https://podcasts.apple.com/podcast/id1'],
    })
    expect(data.sameAs).toEqual(['https://podcasts.apple.com/podcast/id1'])
  })

  it('leaves out what the podcast lacks', () => {
    const data = podcastSeriesJsonLd({
      title: 'Show',
      description: null,
      pageUrl: 'https://pods.example/podcasts/show',
      feedUrl: 'https://pods.example/feed/show',
      image: null,
      author: null,
      category: null,
    })
    expect(JSON.parse(JSON.stringify(data))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'PodcastSeries',
      name: 'Show',
      url: 'https://pods.example/podcasts/show',
      webFeed: 'https://pods.example/feed/show',
    })
  })
})

describe('podcastEpisodeJsonLd', () => {
  const page = {
    podcast: { title: 'Show', slug: 'show' },
    episode: {
      title: 'Ep 1',
      description: '<p>Notes</p>',
      publishedAt: new Date('2026-01-02T03:04:05Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      durationSeconds: 3725,
    },
    pageUrl: 'https://pods.example/podcasts/show/episodes/ep-1',
    audioUrl: 'https://pods.example/api/episodes/1/audio',
    image: null,
  }

  it('describes the episode, its audio and its podcast', () => {
    const [episode] = podcastEpisodeJsonLd(page)
    expect(episode).toMatchObject({
      '@type': 'PodcastEpisode',
      name: 'Ep 1',
      description: 'Notes',
      url: page.pageUrl,
      datePublished: '2026-01-02T03:04:05.000Z',
      duration: 'PT1H2M5S',
      associatedMedia: { '@type': 'AudioObject', contentUrl: page.audioUrl, encodingFormat: 'audio/mpeg' },
      partOfSeries: { '@type': 'PodcastSeries', name: 'Show', url: 'https://pods.example/podcasts/show' },
    })
  })

  it('dates an episode without a publish date by when it was added', () => {
    const [episode] = podcastEpisodeJsonLd({ ...page, episode: { ...page.episode, publishedAt: null } })
    expect(episode!.datePublished).toBe('2026-01-01T00:00:00.000Z')
  })

  it('gives breadcrumbs from the site through the podcast', () => {
    const [, breadcrumbs] = podcastEpisodeJsonLd(page)
    expect(breadcrumbs!.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'podnoms', item: 'https://pods.example/' },
      { '@type': 'ListItem', position: 2, name: 'Show', item: 'https://pods.example/podcasts/show' },
      { '@type': 'ListItem', position: 3, name: 'Ep 1', item: page.pageUrl },
    ])
  })
})

describe('websiteJsonLd', () => {
  it('links the Discord server when there is one', () => {
    const withDiscord = websiteJsonLd({ origin: 'https://pods.example', description: 'd', discordUrl: 'https://discord.gg/x' })
    expect(withDiscord.find((item) => item['@type'] === 'Organization')).toMatchObject({ sameAs: ['https://discord.gg/x'] })
    const without = websiteJsonLd({ origin: 'https://pods.example', description: 'd', discordUrl: null })
    expect(without.find((item) => item['@type'] === 'Organization')).not.toHaveProperty('sameAs')
  })
})
