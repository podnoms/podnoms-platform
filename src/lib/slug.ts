// URL-friendly names: "Fish Go Deep Radio 2026-19" → "fish-go-deep-radio-2026-19".
export function slugify(text: string, fallback: string) {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || fallback
}

// The base slug if it's free, else the first free one of base-2, base-3…
export function firstFreeSlug(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

// Letters and digits that can't be mistaken for each other (no 0/o, 1/i/l).
const shortSlugAlphabet = '23456789abcdefghjkmnpqrstuvwxyz'

// An episode's short slug, for its short link (/s/<slug>): random, as it's
// unique across the whole site. 31^8 makes a clash vanishingly unlikely.
export function randomShortSlug(length = 8) {
  let slug = ''
  while (slug.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // Skips the bytes past the last whole run of the alphabet, so every
      // character is equally likely.
      if (byte < 256 - (256 % shortSlugAlphabet.length) && slug.length < length) slug += shortSlugAlphabet[byte % shortSlugAlphabet.length]
    }
  }
  return slug
}
