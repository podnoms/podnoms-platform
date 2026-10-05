import { describe, expect, it } from 'vitest'
import { binIndex, mapBins } from '~/lib/map-bins'

describe('mapBins', () => {
  it('spaces bins on a log scale up to the largest count', () => {
    expect(mapBins(100)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
      { from: 7, to: 16 },
      { from: 17, to: 40 },
      { from: 41, to: 100 },
    ])
  })

  it('uses fewer bins when the counts are small', () => {
    expect(mapBins(1)).toEqual([{ from: 1, to: 1 }])
    expect(mapBins(3)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ])
  })

  it('has no bins with nothing to show', () => {
    expect(mapBins(0)).toEqual([])
  })
})

describe('binIndex', () => {
  it('finds the bin a count is in', () => {
    const bins = mapBins(100)
    expect(binIndex(bins, 1)).toBe(0)
    expect(binIndex(bins, 16)).toBe(2)
    expect(binIndex(bins, 100)).toBe(4)
    expect(binIndex(bins, 0)).toBe(-1)
  })
})
