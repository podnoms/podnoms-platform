import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  embedPath,
  episodeManagePath,
  episodePath,
  feedPath,
  livePath,
  playlistPath,
  reservedEpisodeSlugs,
  reservedShowSlugs,
  reservedUserSlugs,
  showManagePath,
  showPath,
  userPath,
} from '~/lib/paths'
import { slugify } from '~/lib/slug'

const show = { ownerSlug: 'ada', slug: 'show' }

describe('paths', () => {
  it('puts users at the top level, with their shows and everything about them under them', () => {
    expect(userPath('ada')).toBe('/ada')
    expect(playlistPath('ada', 'mix')).toBe('/ada/playlists/mix')
    expect(showPath(show)).toBe('/ada/show')
    expect(showManagePath(show)).toBe('/ada/show/manage')
    expect(feedPath(show)).toBe('/ada/show/feed')
    expect(livePath(show)).toBe('/ada/show/live')
    expect(episodePath(show, 'ep-1')).toBe('/ada/show/ep-1')
    expect(episodeManagePath(show, 'ep-1')).toBe('/ada/show/ep-1/manage')
    expect(embedPath(show, 'ep-1')).toBe('/embed/ada/show/ep-1')
  })
})

// Each level's slugs share their paths with the site's own routes there,
// which win, so a slug with one of their names could never be reached.
describe('reserved slugs', () => {
  const routes = join(import.meta.dirname, '../../src/routes')
  // Route files' paths as segments ("[.]" is an escaped dot, so
  // robots[.]txt.ts is /robots.txt; other dots nest), with _authed's
  // files (which add no segment) alongside the rest.
  const routePaths = readdirSync(routes, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => {
      const file = join(entry.parentPath, entry.name).slice(routes.length + 1).replace(/\.tsx?$/, '')
      return file
        .replaceAll('[.]', '\0')
        .split(/[./]/)
        .map((segment) => segment.replaceAll('\0', '.').replace(/_$/, ''))
        .filter((segment) => segment !== '_authed' && segment !== 'index')
    })
  // The static segments right after `prefix` (e.g. ['$user']), which a
  // dynamic segment there would clash with.
  const staticAfter = (prefix: string[]) =>
    routePaths
      .filter((path) => path.length > prefix.length && prefix.every((segment, i) => path[i] === segment))
      .map((path) => path[prefix.length]!)
      .filter((segment) => !segment.startsWith('$') && !segment.startsWith('_') && slugify(segment, '') === segment)

  it('include every top-level route a user slug could take', () => {
    const segments = staticAfter([])
    expect(segments.length).toBeGreaterThan(10)
    for (const segment of segments) expect(reservedUserSlugs, segment).toContain(segment)
  })

  it("include every route under a user that a show slug could take", () => {
    const segments = staticAfter(['$user'])
    expect(segments).toContain('playlists')
    for (const segment of segments) expect(reservedShowSlugs, segment).toContain(segment)
  })

  it("include every route under a show that an episode slug could take", () => {
    const segments = staticAfter(['$user', '$show'])
    expect(segments).toEqual(expect.arrayContaining(['feed', 'live', 'manage']))
    for (const segment of segments) expect(reservedEpisodeSlugs, segment).toContain(segment)
  })
})
