import { describe, expect, it } from 'vitest'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles, siteThemeSchema } from '~/lib/theme-schema'

const styles = {
  light: pickStyles(themePresets['modern-minimal']!.styles.light),
  dark: pickStyles(themePresets['modern-minimal']!.styles.dark),
}

describe('siteThemeSchema', () => {
  it('takes every preset', () => {
    for (const preset of Object.values(themePresets)) {
      const theme = {
        basedOn: null,
        styles: { light: pickStyles(preset.styles.light), dark: pickStyles(preset.styles.dark) },
      }
      expect(siteThemeSchema.safeParse(theme).success).toBe(true)
    }
  })

  it('needs every colour', () => {
    const { primary: _, ...light } = styles.light
    expect(siteThemeSchema.safeParse({ basedOn: null, styles: { ...styles, light } }).success).toBe(false)
  })

  it('refuses values that could end the CSS rule they go in', () => {
    for (const bad of ['red; } body { display: none', 'red</style>', '']) {
      const theme = { basedOn: null, styles: { ...styles, light: { ...styles.light, primary: bad } } }
      expect(siteThemeSchema.safeParse(theme).success).toBe(false)
    }
  })
})
