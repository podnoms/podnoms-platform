import { describe, expect, it } from 'vitest'
import { cssColourToHslTriplet } from '~/lib/colour'

describe('cssColourToHslTriplet', () => {
  it.each([
    ['#ffffff', '0 0% 100%'],
    ['#000', '0 0% 0%'],
    ['#ff333380', '0 100% 60%'],
    ['rgb(255 51 51)', '0 100% 60%'],
    ['rgba(255, 51, 51, 0.5)', '0 100% 60%'],
    ['hsl(216 100% 50%)', '216 100% 50%'],
    ['hsl(0deg, 0%, 94.1%)', '0 0% 94.1%'],
    ['hsl(240 0 94)', '240 0% 94%'],
    // The default theme's primary, and oklch with percentages.
    ['oklch(0.6489 0.2370 26.9728)', '0 100% 60%'],
    ['oklch(100% 0 0)', '0 0% 100%'],
    ['oklch(0.5635 0.2408 260.8178 / 0.8)', '216 100% 50%'],
  ])('%s → %s', (colour, triplet) => {
    expect(cssColourToHslTriplet(colour)).toBe(triplet)
  })

  it("is null for what it doesn't understand", () => {
    expect(cssColourToHslTriplet('var(--x)')).toBeNull()
    expect(cssColourToHslTriplet('lab(50 20 20)')).toBeNull()
    expect(cssColourToHslTriplet('#12')).toBeNull()
  })
})
