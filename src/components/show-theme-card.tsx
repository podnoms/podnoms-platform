import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '~/components/icons'
import { PaidFeatureNotice, usePaidAccess } from '~/components/paid-feature-notice'
import { ThemeForm } from '~/components/theme-form'
import { useTheme } from '~/components/theme-provider'
import { Button } from '~/components/ui/button'
import { saveShowTheme } from '~/functions/shows'
import { useBranding } from '~/lib/branding'
import { showPath } from '~/lib/paths'
import { readAppTheme } from '~/lib/theme-browser'
import { themeCss } from '~/lib/theme-css'
import { fontCssUrl, googleFontsIn } from '~/lib/theme-fonts'
import type { SiteTheme } from '~/lib/theme-schema'

const previewStyleId = 'show-theme-preview'

// The theme of the show's public pages (the show, its episodes, live, share
// and embed pages, on the site and its custom domain), over the site's. A
// paid feature (servedShowTheme). It's previewed in the show's page, in a
// frame, so the rest of the site keeps its own look.
export function ShowThemeCard({
  show,
  onChanged,
}: {
  show: { id: string; slug: string; ownerSlug: string; theme: SiteTheme | null }
  onChanged: () => Promise<void>
}) {
  const branding = useBranding()
  const paidAccess = usePaidAccess()
  // The frame's light or dark mode, which the editor switches without
  // changing the site's; until it's switched, the one the owner is using.
  const { resolvedTheme } = useTheme()
  const [chosenMode, setChosenMode] = useState<'light' | 'dark' | null>(null)
  const mode = chosenMode ?? resolvedTheme
  const frame = useRef<HTMLIFrameElement>(null)
  // What's being previewed: null for no theme of the show's own.
  const previewed = useRef<SiteTheme | null>(show.theme)

  // The site's theme, as the show has it until it has its own.
  const base = useCallback(() => branding.theme?.styles ?? readAppTheme(), [branding.theme])

  // Puts the previewed theme into the frame's page (same origin), over the
  // show's saved theme, and its fonts and the mode with it.
  const apply = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.head) return
    const styles = previewed.current?.styles ?? base()
    let style = doc.getElementById(previewStyleId)
    if (!style) {
      style = doc.createElement('style')
      style.id = previewStyleId
      doc.head.append(style)
    }
    style.textContent = themeCss(styles, { over: 'show' })
    for (const font of googleFontsIn({ ...styles.dark, ...styles.light })) {
      const href = fontCssUrl(font)
      if (doc.head.querySelector(`link[href="${href}"]`)) continue
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      doc.head.append(link)
    }
    doc.documentElement.classList.toggle('dark', mode === 'dark')
    doc.documentElement.style.colorScheme = mode
  }, [base, mode])

  useEffect(apply, [apply])

  return (
    <ThemeForm
      title="Theme"
      description="The colours, fonts, corners and shadows of the show's public pages, in light and dark mode. Start from one of the themes, change whatever you like, and see it on the show's page as you go; save it for your listeners to see it."
      saved={show.theme}
      base={base}
      noTheme={`${branding.name}'s own theme.`}
      preview={(theme) => {
        previewed.current = theme
        apply()
      }}
      // Nothing outside the frame was changed.
      endPreview={() => {}}
      // A paid feature. Without it, themes can be tried out here, and one saved
      // before can be taken away; the show's pages stop using it anyway.
      locked={!paidAccess && <PaidFeatureNotice feature="showThemes" />}
      mode={{ value: mode, onChange: setChosenMode }}
      previewPane={
        <section
          aria-labelledby="show-theme-preview-heading"
          className="flex flex-col gap-3 2xl:sticky 2xl:top-[calc(var(--top-nav-height,0px)+1rem)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 id="show-theme-preview-heading" className="text-sm font-semibold">
                Preview
              </h3>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href={showPath(show)} target="_blank" rel="noreferrer">
                <Icons.externalLink />
                Open the page
              </a>
            </Button>
          </div>
          <iframe
            ref={frame}
            src={showPath(show)}
            title="Preview of your show's page"
            onLoad={apply}
            className="h-[40rem] w-full rounded-lg border bg-background"
          />
        </section>
      }
      onSave={async (theme) => {
        await saveShowTheme({ data: { id: show.id, theme } })
        await onChanged()
      }}
    />
  )
}
