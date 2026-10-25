import { describe, expect, it } from 'vitest'
import { themeCss } from '~/lib/theme-css'
import { themePresets, type ThemePreset } from '~/lib/theme-presets'

// The variables set for each mode, by selector.
function parse(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => [
      selector,
      Object.fromEntries(body!.split(';').map((rule) => [rule.slice(0, rule.indexOf(':')), rule.slice(rule.indexOf(':') + 1)])),
    ]),
  ) as Record<string, Record<string, string>>
}

const preset = themePresets['modern-minimal']!

describe('themeCss', () => {
  it("overrides app.css's light and dark variables, outranking :root and .dark", () => {
    const css = parse(themeCss(preset.styles))
    expect(Object.keys(css)).toEqual(['html:root', 'html.dark'])
    expect(css['html:root']!['--primary']).toBe(preset.styles.light.primary)
    expect(css['html.dark']!['--primary']).toBe(preset.styles.dark.primary)
    expect(css['html:root']!['--sidebar-ring']).toBe(preset.styles.light['sidebar-ring'])
    expect(css['html:root']!['--radius']).toBe(preset.styles.light.radius)
  })

  it('builds the shadow scale from the shadow settings', () => {
    const custom: ThemePreset = {
      ...preset,
      styles: {
        light: {
          ...preset.styles.light,
          'shadow-color': '#000000',
          'shadow-opacity': '0.2',
          'shadow-blur': '4px',
          'shadow-spread': '0px',
          'shadow-offset-x': '2px',
          'shadow-offset-y': '3px',
        },
        dark: preset.styles.dark,
      },
    }
    const css = parse(themeCss(custom.styles))
    expect(css['html:root']!['--shadow-xs']).toBe('2px 3px 4px 0px color-mix(in srgb, #000000 10%, transparent)')
    expect(css['html:root']!['--shadow-md']).toBe(
      '2px 3px 4px 0px color-mix(in srgb, #000000 20%, transparent), 2px 2px 4px calc(0px - 1px) color-mix(in srgb, #000000 20%, transparent)',
    )
    // The dark mode, which doesn't describe its shadows, takes the light mode's.
    expect(css['html.dark']!['--shadow-xs']).toBe(css['html:root']!['--shadow-xs'])
  })

  it('gives a preset without shadow settings a soft default shadow', () => {
    const { light, dark } = preset.styles
    const strip = (styles: typeof light) =>
      Object.fromEntries(Object.entries(styles).filter(([key]) => !key.startsWith('shadow'))) as typeof light
    const css = parse(themeCss({ light: strip(light), dark: strip(dark) }))
    expect(css['html:root']!['--shadow-2xs']).toBe('0 1px 3px 0px color-mix(in srgb, hsl(0 0% 0%) 5%, transparent)')
  })

  it("sets the theme's fonts", () => {
    const css = parse(themeCss(preset.styles))
    expect(css['html:root']!['--font-sans']).toBe(preset.styles.light['font-sans'])
    expect(css['html:root']!['--font-mono']).toBe(preset.styles.light['font-mono'])
  })

  it('makes CSS for every preset', () => {
    for (const each of Object.values(themePresets)) {
      expect(Object.keys(parse(themeCss(each.styles)))).toEqual(['html:root', 'html.dark'])
    }
  })
})
