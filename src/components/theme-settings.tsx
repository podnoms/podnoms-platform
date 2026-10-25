import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ThemeEditor } from '~/components/theme-editor'
import { ThemePicker } from '~/components/theme-picker'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { FieldError } from '~/components/ui/field'
import { saveSiteTheme } from '~/functions/branding'
import { siteThemeStyleId, useBranding } from '~/lib/branding'
import { loadFonts, readAppTheme } from '~/lib/theme-browser'
import { themeCss } from '~/lib/theme-css'
import { googleFontsIn } from '~/lib/theme-fonts'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles, type SiteTheme, type ThemeModes } from '~/lib/theme-schema'

// Shows the theme on this page alone, by replacing the site theme the root
// route puts in <head> (see siteThemeStyleId); null shows app.css's own.
function preview(theme: SiteTheme | null) {
  const style = document.getElementById(siteThemeStyleId)
  if (style) style.textContent = theme ? themeCss(theme.styles) : ''
}

// The preset's values, as the site's theme keeps them.
function presetStyles(preset: string): ThemeModes {
  const { light, dark } = themePresets[preset]!.styles
  return { light: pickStyles(light), dark: pickStyles(dark) }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The site's theme, for every visitor, on the admin page: a preset to start
// from, then any of its values changed. Changes show on this page as they're
// made; they're only the site's once saved.
export function ThemeSettings() {
  const branding = useBranding()
  const router = useRouter()
  const saved: SiteTheme | null = branding.theme && { basedOn: branding.theme.basedOn, styles: branding.theme.styles }
  const [draft, setDraft] = useState(saved)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const changed = !same(draft, saved)
  // Whether it's been changed from the preset (or app.css's theme) it started from.
  const edited = draft !== null && (draft.basedOn === null || !same(draft.styles, presetStyles(draft.basedOn)))

  const latestSaved = useRef(saved)
  latestSaved.current = saved

  useEffect(() => {
    preview(draft)
    if (draft) loadFonts(googleFontsIn({ ...draft.styles.dark, ...draft.styles.light }))
  }, [draft])
  // Leaving the page drops an unsaved preview.
  useEffect(() => () => preview(latestSaved.current), [])

  function choose(preset: string | null) {
    setDraft(preset && themePresets[preset] ? { basedOn: preset, styles: presetStyles(preset) } : null)
  }

  async function save() {
    setError(undefined)
    setPending(true)
    try {
      await saveSiteTheme({ data: { theme: draft } })
      await router.invalidate()
    } catch {
      setError('Something went wrong saving the theme. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          The site's colours, fonts, corners and shadows, in light and dark mode, for everyone who visits. Start from
          one of the themes, change whatever you like, and see it on this page as you go; save it to use it everywhere.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <ThemePicker value={draft?.basedOn ?? null} edited={edited} onChange={choose} />
          {edited && (
            <Button type="button" variant="ghost" size="sm" onClick={() => choose(draft.basedOn)}>
              Undo changes to the theme
            </Button>
          )}
          {changed && <span className="text-sm text-muted-foreground">Previewing, not saved yet</span>}
        </div>

        {draft ? (
          <ThemeEditor styles={draft.styles} onChange={(styles) => setDraft({ ...draft, styles })} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
            <p className="text-sm text-muted-foreground">The site's own theme. Choose a theme above, or change this one.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setDraft({ basedOn: null, styles: readAppTheme() })}
            >
              Edit this theme
            </Button>
          </div>
        )}

        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={pending || !changed} onClick={save}>
            Save theme
          </Button>
          <Button type="button" variant="outline" disabled={pending || !changed} onClick={() => setDraft(saved)}>
            Revert to the saved theme
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
