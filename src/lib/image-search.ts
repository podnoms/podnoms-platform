// Searches for artwork that suits a show or episode, from what's known
// about it so far (see image-suggestions.server.ts).
import { z } from 'zod'
import { htmlToText } from '~/lib/rich-text'

export const imageSuggestionSchema = z.object({
  title: z.string().max(500).optional(),
  // HTML, as descriptions are stored.
  description: z.string().max(20000).optional(),
  // More to go on when the rest says little, e.g. an episode's show title.
  context: z.string().max(500).optional(),
  // Images already suggested in this form, so the next one is different.
  exclude: z.array(z.string().max(100)).max(200).default([]),
})
export type ImageSuggestionInput = z.input<typeof imageSuggestionSchema>

// Words that say nothing about what a picture should show.
const fillerWords = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other
  our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when where which while who whom why will
  with you your yours yourself yourselves
  episode episodes podcast podcasts show shows part feat featuring ft vol volume edition special presents present new best
  www com http https html`
    .split(/\s+/)
    .filter(Boolean),
)

// The words worth searching for, in order, repeats included.
function words(text: string) {
  return (text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{3,}/g) ?? []).filter(
    (word) => !fillerWords.has(word),
  )
}

// The same, without repeats.
export function searchWords(text: string) {
  return [...new Set(words(text))]
}

// The words most used first, e.g. in a description.
function commonWords(text: string) {
  const counts = new Map<string, number>()
  for (const word of words(text)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([word]) => word)
}

// Searches to try in turn, most specific first, until one finds something.
// The first ones mix the title with the description's main word, so the photo
// suits both; image search matches every word, so later searches use fewer.
export function imageSearchQueries({ title = '', description = '', context = '' }: ImageSuggestionInput) {
  const [t1, t2, t3] = searchWords(title)
  const [d1, d2] = commonWords(htmlToText(description)).filter((word) => word !== t1 && word !== t2 && word !== t3)
  const [c1, c2] = searchWords(context)
  const queries = [[t1, t2, d1], [t1, t2], [t1, d1], [d1, d2], [t1], [d1], [t2], [d2], [t3], [c1], [c2], ['music']]
  return [...new Set(queries.map((words) => words.filter(Boolean).join(' ')).filter(Boolean))]
}
