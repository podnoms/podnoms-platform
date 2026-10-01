import { describe, expect, it } from 'vitest'
import { formatBytes, formatClock, formatDate, formatLength, formatTimeLeft, hostname } from '~/lib/format'

describe('formatDate', () => {
  it('formats in UTC regardless of the local time zone', () => {
    expect(formatDate(new Date('2026-03-05T23:30:00Z'))).toBe('5 Mar 2026')
    expect(formatDate(new Date('2026-03-06T00:30:00+02:00'))).toBe('5 Mar 2026')
  })
})

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [750, '12:30'],
    [3600, '1:00:00'],
    [7210, '2:00:10'],
  ])('%s seconds → %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected)
  })

  it('drops fractions and clamps negatives to zero', () => {
    expect(formatClock(59.99)).toBe('0:59')
    expect(formatClock(-10)).toBe('0:00')
  })
})

describe('formatLength', () => {
  it.each([
    [0, '1 min'],
    [20, '1 min'],
    [45 * 60, '45 min'],
    [60 * 60, '1 h'],
    [125 * 60, '2 h 5 min'],
    [89, '1 min'],
    [90, '2 min'],
  ])('%s seconds → %s', (seconds, expected) => {
    expect(formatLength(seconds)).toBe(expected)
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '1 KB'],
    [100, '1 KB'],
    [2048, '2 KB'],
    [999 * 1024, '999 KB'],
    [1000 * 1024, '1.0 MB'],
    [5.25 * 1024 * 1024, '5.3 MB'],
    [1000 * 1024 * 1024, '0.98 GB'],
    [3 * 1024 * 1024 * 1024, '3.00 GB'],
  ])('%s bytes → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('formatTimeLeft', () => {
  it('shows seconds under a minute, at least 1', () => {
    expect(formatTimeLeft(0)).toBe('1s left')
    expect(formatTimeLeft(42.4)).toBe('42s left')
  })

  it('shows minutes and hours from a minute up', () => {
    expect(formatTimeLeft(60)).toBe('1 min left')
    expect(formatTimeLeft(3900)).toBe('1 h 5 min left')
  })
})

describe('hostname', () => {
  it('returns the host without www', () => {
    expect(hostname('https://www.youtube.com/watch?v=abc')).toBe('youtube.com')
    expect(hostname('https://soundcloud.com/artist/track')).toBe('soundcloud.com')
  })

  it('returns the input when it is not a URL', () => {
    expect(hostname('not a url')).toBe('not a url')
  })
})
