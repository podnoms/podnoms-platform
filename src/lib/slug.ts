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
