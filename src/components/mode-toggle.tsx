import { Icons } from '~/components/icons'
import { useTheme } from '~/components/theme-provider'
import { Button } from '~/components/ui/button'

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {/* Both icons are rendered and swapped by the .dark class on <html>,
          which is set before first paint, so the icon never flashes. */}
      <Icons.moon className="dark:hidden" />
      <Icons.sun className="hidden dark:block" />
    </Button>
  )
}
