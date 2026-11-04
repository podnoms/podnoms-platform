import { useRouter } from '@tanstack/react-router'
import { ThemeForm } from '~/components/theme-form'
import { saveSiteTheme } from '~/functions/branding'
import { siteThemeStyleId, useBranding } from '~/lib/branding'
import { readAppTheme } from '~/lib/theme-browser'
import { themeCss } from '~/lib/theme-css'
import type { SiteTheme } from '~/lib/theme-schema'

// Shows the theme on this page alone, by replacing the site theme the root
// route puts in <head> (see siteThemeStyleId); null shows app.css's own.
function preview(theme: SiteTheme | null) {
  const style = document.getElementById(siteThemeStyleId)
  if (style) style.textContent = theme ? themeCss(theme.styles) : ''
}

// The site's theme, for every visitor, on the admin page. Shows can have their
// own over it (ShowThemeCard).
export function ThemeSettings() {
  const branding = useBranding()
  const router = useRouter()
  const saved: SiteTheme | null = branding.theme && { basedOn: branding.theme.basedOn, styles: branding.theme.styles }
  return (
    <ThemeForm
      title="Theme"
      description="The site's colours, fonts, corners and shadows, in light and dark mode, for everyone who visits. Start from one of the themes, change whatever you like, and see it on this page as you go; save it to use it everywhere."
      saved={saved}
      base={readAppTheme}
      noTheme="The site's own theme."
      preview={preview}
      endPreview={preview}
      onSave={async (theme) => {
        await saveSiteTheme({ data: { theme } })
        await router.invalidate()
      }}
    />
  )
}
