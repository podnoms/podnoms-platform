// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '~/components/theme-provider'

// The pre-paint script needs a router; what it does is mirrored by applyTheme.
vi.mock('@tanstack/react-router', () => ({ ScriptOnce: () => null }))

let prefersDark = false
let mediaListeners: (() => void)[] = []

beforeEach(() => {
  prefersDark = false
  mediaListeners = []
  localStorage.clear()
  document.documentElement.className = ''
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(prefers-color-scheme: dark)' && prefersDark
    },
    addEventListener: (_: string, listener: () => void) => mediaListeners.push(listener),
    removeEventListener: (_: string, listener: () => void) => (mediaListeners = mediaListeners.filter((l) => l !== listener)),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

let current: ReturnType<typeof useTheme>
function Probe() {
  current = useTheme()
  return <span data-testid="theme">{`${current.theme}/${current.resolvedTheme}`}</span>
}

const shown = () => screen.getByTestId('theme').textContent
const isDark = () => document.documentElement.classList.contains('dark')

describe('ThemeProvider', () => {
  it('follows the system theme by default', () => {
    prefersDark = true
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown()).toBe('system/dark')
  })

  it('restores a stored choice', () => {
    localStorage.setItem('theme', 'dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown()).toBe('dark/dark')
  })

  it('ignores invalid stored values', () => {
    localStorage.setItem('theme', 'purple')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(shown()).toBe('system/light')
  })

  it('applies, stores and reports a chosen theme', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => current.setTheme('dark'))
    expect(shown()).toBe('dark/dark')
    expect(isDark()).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    act(() => current.setTheme('light'))
    expect(isDark()).toBe(false)
  })

  it('tracks OS changes only while following the system', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    prefersDark = true
    act(() => mediaListeners.forEach((l) => l()))
    expect(shown()).toBe('system/dark')
    expect(isDark()).toBe(true)

    act(() => current.setTheme('light'))
    expect(mediaListeners).toHaveLength(0)
  })

  it('throws when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useTheme must be used within a ThemeProvider')
  })
})
