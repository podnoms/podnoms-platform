import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ThemeEditor } from '~/components/theme-editor'
import { ThemePicker } from '~/components/theme-picker'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { FieldError } from '~/components/ui/field'
import { loadFonts } from '~/lib/theme-browser'
import { googleFontsIn } from '~/lib/theme-fonts'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles, type SiteTheme, type ThemeModes } from '~/lib/theme-schema'

// The preset's values, as a saved theme keeps them.
function presetStyles(preset: string): ThemeModes {
  const { light, dark } = themePresets[preset]!.styles
  return { light: pickStyles(light), dark: pickStyles(dark) }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// A theme to save, the site's (ThemeSettings) or a show's (ShowThemeCard): a
// preset to start from, then any of its values changed, or none (null) for
// the theme beneath it. Changes show on the page as they're made, through
// `preview`; they only count once saved.
export function ThemeForm({
  title,
  description,
  saved,
  base,
  noTheme,
  preview,
  endPreview,
  onSave,
  locked,
  previewPane,
  mode,
}: {
  title: string
  description: ReactNode
  saved: SiteTheme | null
  // What having no theme looks like, as the values to start from when it's edited.
  base: () => ThemeModes
  // Says what having no theme means here.
  noTheme: string
  // Shows a theme (null: no theme) on this page while it's edited…
  preview: (theme: SiteTheme | null) => void
  // …and puts the page back when it's left, given what was saved.
  endPreview: (saved: SiteTheme | null) => void
  onSave: (theme: SiteTheme | null) => Promise<void>
  // Why a theme can't be saved (it can still be tried out, or taken away).
  locked?: ReactNode
  // Where the theme is previewed, when it isn't this page; kept in view
  // beside the editor on wide screens.
  previewPane?: ReactNode
  // The preview's own light or dark mode, rather than the site's (ThemeEditor).
  mode?: ComponentProps<typeof ThemeEditor>['mode']
}) {
  const [draft, setDraft] = useState(saved)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const changed = !same(draft, saved)
  // Whether it's been changed from the preset (or the theme beneath) it started from.
  const edited = draft !== null && (draft.basedOn === null || !same(draft.styles, presetStyles(draft.basedOn)))

  const latest = useRef({ saved, endPreview })
  latest.current = { saved, endPreview }

  useEffect(() => {
    preview(draft)
    if (draft) loadFonts(googleFontsIn({ ...draft.styles.dark, ...draft.styles.light }))
    // `preview` is the caller's; only a new draft needs showing.
  }, [draft])
  // Leaving the page drops an unsaved preview.
  useEffect(() => () => latest.current.endPreview(latest.current.saved), [])

  function choose(preset: string | null) {
    setDraft(preset && themePresets[preset] ? { basedOn: preset, styles: presetStyles(preset) } : null)
  }

  async function save() {
    setError(undefined)
    setPending(true)
    try {
      await onSave(draft)
    } catch {
      setError('Something went wrong saving the theme. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {locked}
        <div className="flex flex-wrap items-center gap-3">
          <ThemePicker value={draft?.basedOn ?? null} edited={edited} onChange={choose} />
          {edited && (
            <Button type="button" variant="ghost" size="sm" onClick={() => choose(draft.basedOn)}>
              Undo changes to the theme
            </Button>
          )}
          {changed && <span className="text-sm text-muted-foreground">Previewing, not saved yet</span>}
        </div>

        <div className={previewPane ? 'grid items-start gap-6 2xl:grid-cols-2' : 'contents'}>
          {draft ? (
            <ThemeEditor styles={draft.styles} mode={mode} onChange={(styles) => setDraft({ ...draft, styles })} />
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <p className="text-sm text-muted-foreground">{noTheme} Choose a theme above, or change this one.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setDraft({ basedOn: null, styles: base() })}
              >
                Edit this theme
              </Button>
            </div>
          )}
          {previewPane}
        </div>

        {error && <FieldError>{error}</FieldError>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={pending || !changed || Boolean(locked && draft)} onClick={save}>
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
