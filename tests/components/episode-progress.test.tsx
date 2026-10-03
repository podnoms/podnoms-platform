// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EpisodeProgress } from '~/components/episode-progress'

afterEach(cleanup)

// How far the bar is filled, from its indicator's offset.
const filled = () => {
  const transform = (document.querySelector('[data-slot="progress-indicator"]') as HTMLElement).style.transform
  return 100 - Number(/translateX\(-([\d.]+)%\)/.exec(transform)![1])
}

describe('EpisodeProgress', () => {
  it('says it is waiting when the server has no progress', () => {
    render(<EpisodeProgress progress={null} />)
    expect(screen.getByText('Waiting for the server to pick this up…')).toBeTruthy()
  })

  it('shows the place in the queue', () => {
    render(<EpisodeProgress progress={{ stage: 'queued', ahead: 2 }} />)
    expect(screen.getByText('Waiting to start · 2 ahead in the queue')).toBeTruthy()
  })

  it('says it is starting when first in the queue', () => {
    render(<EpisodeProgress progress={{ stage: 'queued', ahead: 0 }} />)
    expect(screen.getByText('Starting…')).toBeTruthy()
  })

  it('shows fetching', () => {
    render(<EpisodeProgress progress={{ stage: 'fetching' }} />)
    expect(screen.getByText('Fetching details…')).toBeTruthy()
  })

  it('shows download percentage, size, speed and time left', () => {
    render(
      <EpisodeProgress
        progress={{ stage: 'downloading', downloadedBytes: 512 * 1024, totalBytes: 2048 * 1024, bytesPerSecond: 256 * 1024, secondsLeft: 6 }}
      />,
    )
    expect(screen.getByText('Downloading · 25%')).toBeTruthy()
    expect(screen.getByText('512 KB of 2.0 MB · 256 KB/s · 6s left')).toBeTruthy()
    expect(filled()).toBe(25)
  })

  it('shows just the downloaded size when the total is unknown', () => {
    render(<EpisodeProgress progress={{ stage: 'downloading', downloadedBytes: 4096, totalBytes: null, bytesPerSecond: null, secondsLeft: null }} />)
    expect(screen.getByText('Downloading')).toBeTruthy()
    expect(screen.getByText('4 KB')).toBeTruthy()
  })

  it('shows conversion percentage for uploads', () => {
    render(<EpisodeProgress progress={{ stage: 'converting', percent: 40 }} />)
    expect(screen.getByText('Converting audio · 40%')).toBeTruthy()
    expect(filled()).toBe(40)
  })

  it('shows conversion without a percentage for downloads', () => {
    render(<EpisodeProgress progress={{ stage: 'converting', percent: null }} />)
    expect(screen.getByText('Converting audio…')).toBeTruthy()
    expect(filled()).toBe(100)
  })
})
