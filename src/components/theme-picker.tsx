import { useEffect, useRef, useState } from 'react'
import { Icons } from '~/components/icons'
import { useTheme } from '~/components/theme-provider'
import { Button } from '~/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { loadFonts } from '~/lib/theme-browser'
import { firstFamily } from '~/lib/theme-fonts'
import { themePresets } from '~/lib/theme-presets'
import { cn } from '~/lib/utils'

// Every preset, with the colours its swatches show and the font its name is
// shown in, as tweakcn shows them, after app.css's own theme (`value: null`),
// which is shown in the page's own font.
const themes = [
  { name: 'Default', value: null, font: undefined, colors: null },
  ...Object.entries(themePresets).map(([value, preset]) => ({
    name: preset.label,
    value: value as string | null,
    font: (preset.styles.light['font-sans'] || undefined) as string | undefined,
    colors: {
      primary: preset.styles.light.primary,
      accent: preset.styles.light.accent,
      secondary: preset.styles.light.secondary,
    },
  })),
]

type Theme = (typeof themes)[number]

// The preset's three colours, as swatches. The colours are the preset's own
// data, shown so admins can tell the presets apart.
function Swatches({ theme, size }: { theme: Theme; size: 'sm' | 'md' }) {
  if (!theme.colors) return <Icons.palette className={size === 'sm' ? 'size-3.5' : 'size-5'} />
  const box =
    size === 'sm'
      ? 'size-3.5 border-y first:rounded-l-sm first:border-l last:rounded-r-sm last:border-r'
      : 'size-5 rounded-sm border'
  return (
    <div className={cn('flex', size === 'sm' ? 'gap-0.5' : 'gap-1')}>
      {[theme.colors.primary, theme.colors.accent, theme.colors.secondary].map((color, i) => (
        <div key={i} className={cn(box, 'border-foreground/20')} style={{ backgroundColor: color }} />
      ))}
    </div>
  )
}

// Chooses one of the theme presets (see theme-presets.ts), or app.css's own
// theme (null), as the starting point for the site's theme; `edited` says it's
// been changed since. Light and dark mode switch the admin's own view, to see both.
export function ThemePicker({
  value,
  edited = false,
  onChange,
}: {
  value: string | null
  edited?: boolean
  onChange: (value: string | null) => void
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const currentIndex = Math.max(0, themes.findIndex((theme) => theme.value === value))
  const current = themes[currentIndex]!
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const activeButton = useRef<HTMLButtonElement>(null)

  const shown = themes.filter((theme) => theme.name.toLowerCase().includes(search.trim().toLowerCase()))

  // Each theme's font, for its name: the chosen one's at once, the rest when
  // the list opens.
  useEffect(() => loadFonts([firstFamily(current.font)]), [current.font])
  useEffect(() => {
    if (open) loadFonts(themes.map((theme) => firstFamily(theme.font)))
  }, [open])

  // Brings the chosen theme into view when the list opens.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => activeButton.current?.scrollIntoView({ block: 'nearest' }), 100)
    return () => clearTimeout(timer)
  }, [open, value])

  const step = (by: number) => onChange(themes[(currentIndex + by + themes.length) % themes.length]!.value)

  return (
    <TooltipProvider>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2"
                aria-label={`Theme: ${current.name}${edited ? ', edited' : ''}`}
              >
                <Swatches theme={current} size="sm" />
                <span style={{ fontFamily: current.font }}>{current.name}</span>
                {edited && <span className="text-muted-foreground">(edited)</span>}
                <Icons.chevronDown className="opacity-50" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{current.name}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="max-h-[500px] w-80 p-0">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous theme">
                <Icons.chevronLeft />
              </Button>
              <span className="text-sm font-semibold">Appearance</span>
              <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next theme">
                <Icons.chevronRight />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Icons.moon className="dark:hidden" />
              <Icons.sun className="hidden dark:block" />
            </Button>
          </div>

          <DropdownMenuSeparator />

          <div className="p-2">
            <div className="relative">
              <Icons.search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search themes…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                // Typing goes to the field, not the menu's type-to-select.
                onKeyDown={(event) => event.stopPropagation()}
                className="pl-8"
              />
            </div>
          </div>

          <div className="px-2 py-1 text-xs text-muted-foreground">
            {shown.length} {shown.length === 1 ? 'theme' : 'themes'}
          </div>

          <div className="max-h-[300px] overflow-y-auto overscroll-contain">
            <div className="grid gap-1 p-1">
              {shown.map((theme) => (
                <button
                  key={theme.value ?? 'default'}
                  type="button"
                  ref={value === theme.value ? activeButton : null}
                  onClick={() => {
                    onChange(theme.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    value === theme.value && 'bg-accent text-accent-foreground',
                  )}
                >
                  <div className="flex flex-1 items-center gap-2">
                    <Swatches theme={theme} size="md" />
                    <span className="text-sm" style={{ fontFamily: theme.font }}>
                      {theme.name}
                    </span>
                  </div>
                  {value === theme.value && <Icons.check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
