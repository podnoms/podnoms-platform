import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { episodePath, podcastPath, reservedPodcastSlugs } from '~/lib/paths'
import { slugify } from '~/lib/slug'

describe('podcast paths', () => {
  it('serves podcasts and their episodes at the top level', () => {
    expect(podcastPath('show')).toBe('/show')
    expect(episodePath('show', 'ep-1')).toBe('/show/episodes/ep-1')
  })

  // Podcasts share the top level with the site's own pages, which win, so a
  // podcast with one of their names could never be reached.
  it("reserves every top-level route's name a slug could take", () => {
    const routes = join(import.meta.dirname, '../../src/routes')
    const firstSegments = readdirSync(routes)
      .flatMap((name) => (name === '_authed' ? readdirSync(join(routes, name)) : [name]))
      // "[.]" is an escaped dot (robots[.]txt.ts is /robots.txt); other dots nest.
      .map((name) => name.replace(/\.tsx?$/, '').replaceAll('[.]', '\0').split('.')[0]!.replaceAll('\0', '.'))
      .filter((segment) => !segment.startsWith('$') && !segment.startsWith('_') && segment !== 'index')
    expect(firstSegments.length).toBeGreaterThan(10)
    for (const segment of firstSegments) {
      // Names a slug can't be (e.g. sitemap.xml) don't need reserving.
      if (slugify(segment, '') !== segment) continue
      expect(reservedPodcastSlugs, segment).toContain(segment)
    }
  })
})
