// Podcast directories (Apple Podcasts, Spotify and the rest), what they need
// from a podcast before they'll list it, and the lists its feed is described
// with: Apple's categories and the languages podcasts are offered in.

// Apple's podcast categories, each with its subcategories, as Apple names them.
// Other directories read the same itunes:category tags. See
// https://podcasters.apple.com/support/1691-apple-podcasts-categories
export const appleCategories = {
  Arts: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'],
  Business: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'],
  Comedy: ['Comedy Interviews', 'Improv', 'Stand-Up'],
  Education: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'],
  Fiction: ['Comedy Fiction', 'Drama', 'Science Fiction'],
  Government: [],
  History: [],
  'Health & Fitness': ['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition', 'Sexuality'],
  'Kids & Family': ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'],
  Leisure: ['Animation & Manga', 'Automotive', 'Aviation', 'Crafts', 'Games', 'Hobbies', 'Home & Garden', 'Video Games'],
  Music: ['Music Commentary', 'Music History', 'Music Interviews'],
  News: ['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News'],
  'Religion & Spirituality': ['Buddhism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Religion', 'Spirituality'],
  Science: [
    'Astronomy',
    'Chemistry',
    'Earth Sciences',
    'Life Sciences',
    'Mathematics',
    'Natural Sciences',
    'Nature',
    'Physics',
    'Social Sciences',
  ],
  'Society & Culture': ['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships'],
  Sports: [
    'Baseball',
    'Basketball',
    'Cricket',
    'Fantasy Sports',
    'Football',
    'Golf',
    'Hockey',
    'Rugby',
    'Running',
    'Soccer',
    'Swimming',
    'Tennis',
    'Volleyball',
    'Wilderness',
    'Wrestling',
  ],
  Technology: [],
  'True Crime': [],
  'TV & Film': ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'],
} as const satisfies Record<string, readonly string[]>

export type AppleCategory = keyof typeof appleCategories

export const categoryNames = Object.keys(appleCategories) as AppleCategory[]

export function isSubcategoryOf(category: string, subcategory: string) {
  const subcategories: readonly string[] = appleCategories[category as AppleCategory] ?? []
  return subcategories.includes(subcategory)
}

// The languages a podcast can be marked as being in (an RSS <language> code),
// named in the reader's own language where the browser knows it.
export const podcastLanguages = [
  'ar', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-ie', 'en-nz', 'en-us', 'es',
  'es-mx', 'et', 'eu', 'fa', 'fi', 'fr', 'fr-ca', 'ga', 'gd', 'gl', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it',
  'ja', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'pt-br', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw',
  'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh-cn', 'zh-tw',
] as const

export function languageName(code: string, locale = 'en') {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export type DirectoryId = 'apple' | 'spotify' | 'podcastIndex' | 'amazon' | 'youtube' | 'pocketCasts'

export type Directory = {
  id: DirectoryId
  name: string
  // Where the owner goes to add their show.
  submitUrl: string
  steps: string[]
  // Whether a pasted listing link is really one of this directory's pages.
  isListingUrl: (url: URL) => boolean
  // An example listing link, for the field's placeholder.
  example: string
}

const host = (url: URL) => url.hostname.replace(/^www\./, '')

export const directories: Directory[] = [
  {
    id: 'apple',
    name: 'Apple Podcasts',
    submitUrl: 'https://podcastsconnect.apple.com/',
    steps: [
      'Sign in to Podcasts Connect with your Apple Account.',
      'Click + and choose New Show, then "Add a show with an RSS feed".',
      'Paste your feed URL and submit it for review. Approval usually takes a day or two.',
    ],
    isListingUrl: (url) => host(url) === 'podcasts.apple.com' || host(url) === 'itunes.apple.com',
    example: 'https://podcasts.apple.com/podcast/id123456789',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    submitUrl: 'https://creators.spotify.com/',
    steps: [
      'Sign in to Spotify for Creators and choose "Find an existing show".',
      'Paste your feed URL.',
      'Spotify emails a code to the owner email in your feed: enter it to confirm the show is yours.',
    ],
    isListingUrl: (url) => host(url) === 'open.spotify.com' && url.pathname.startsWith('/show/'),
    example: 'https://open.spotify.com/show/…',
  },
  {
    id: 'podcastIndex',
    name: 'Podcast Index',
    submitUrl: 'https://podcastindex.org/add',
    steps: [
      'Paste your feed URL on Podcast Index’s "Add a podcast" page.',
      'Apps such as Fountain, Podverse and Castamatic find shows through it.',
    ],
    isListingUrl: (url) => host(url) === 'podcastindex.org' && url.pathname.startsWith('/podcast/'),
    example: 'https://podcastindex.org/podcast/123456',
  },
  {
    id: 'amazon',
    name: 'Amazon Music',
    submitUrl: 'https://podcasters.amazon.com/',
    steps: [
      'Sign in to Amazon Music for Podcasters and choose "Add your podcast".',
      'Paste your feed URL and confirm the show is yours with the code Amazon emails to your owner email.',
    ],
    isListingUrl: (url) => /^music\.amazon\.[a-z.]+$/.test(host(url)),
    example: 'https://music.amazon.com/podcasts/…',
  },
  {
    id: 'youtube',
    name: 'YouTube Music',
    submitUrl: 'https://studio.youtube.com/',
    steps: [
      'In YouTube Studio, choose Create → New podcast → "Submit an RSS feed".',
      'Paste your feed URL and confirm with the code YouTube emails to your owner email.',
    ],
    isListingUrl: (url) =>
      host(url) === 'music.youtube.com' || (host(url) === 'youtube.com' && url.pathname.startsWith('/playlist')),
    example: 'https://music.youtube.com/playlist?list=…',
  },
  {
    id: 'pocketCasts',
    name: 'Pocket Casts',
    submitUrl: 'https://pocketcasts.com/submit/',
    steps: ['Paste your feed URL on Pocket Casts’ submit page. Shows usually appear within a few hours.'],
    isListingUrl: (url) => host(url) === 'pca.st' || host(url) === 'pocketcasts.com',
    example: 'https://pca.st/podcast/…',
  },
]

export const directoryIds = directories.map((directory) => directory.id)

export type DirectoryLinks = Partial<Record<DirectoryId, string>>

// Whether `link` is a listing page of the directory with this id.
export function isDirectoryListing(id: DirectoryId, link: string) {
  const directory = directories.find((entry) => entry.id === id)
  if (!directory) return false
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && directory.isListingUrl(url)
  } catch {
    return false
  }
}

export type ReadinessItem = {
  id: 'title' | 'description' | 'artwork' | 'category' | 'language' | 'author' | 'episode' | 'listed' | 'ownerEmail'
  ok: boolean
  label: string
  // What to do about it when it isn't ok.
  fix: string
  // Only some directories need it (an owner email, for those that verify by email).
  optional?: boolean
}

// What directories check before listing a podcast. All but the optional items
// must be ok before it's worth submitting.
export function directoryReadiness(podcast: {
  title: string
  description: string | null
  artwork: string | null
  category: string | null
  language: string | null
  author: string | null
  publishedEpisodes: number
  private: boolean
  ownerEmail: string | null
}): ReadinessItem[] {
  return [
    { id: 'title', ok: Boolean(podcast.title.trim()), label: 'Title', fix: 'Give your podcast a title.' },
    {
      id: 'description',
      ok: Boolean(podcast.description?.replace(/<[^>]*>/g, '').trim()),
      label: 'Description',
      fix: 'Describe your podcast: directories show it on its page.',
    },
    {
      id: 'artwork',
      ok: Boolean(podcast.artwork),
      label: 'Artwork',
      fix: 'Add square artwork: directories won’t list a show without it.',
    },
    { id: 'category', ok: Boolean(podcast.category), label: 'Category', fix: 'Choose a category.' },
    { id: 'language', ok: Boolean(podcast.language), label: 'Language', fix: 'Choose the language it’s in.' },
    { id: 'author', ok: Boolean(podcast.author?.trim()), label: 'Author', fix: 'Say who makes it.' },
    {
      id: 'episode',
      ok: podcast.publishedEpisodes > 0,
      label: 'At least one episode',
      fix: 'Publish an episode: directories won’t list an empty show.',
    },
    {
      id: 'listed',
      ok: !podcast.private,
      label: 'Listed publicly',
      fix: 'Your podcast is private, so its feed asks directories not to list it.',
    },
    {
      id: 'ownerEmail',
      ok: Boolean(podcast.ownerEmail),
      label: 'Owner email',
      fix: 'Spotify, Amazon and YouTube send a code here to confirm the show is yours.',
      optional: true,
    },
  ]
}

export const isReady = (items: ReadinessItem[]) => items.every((item) => item.ok || item.optional)
