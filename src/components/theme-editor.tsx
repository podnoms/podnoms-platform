import { useEffect, useId, useState } from 'react'
import { Icons } from '~/components/icons'
import { useTheme } from '~/components/theme-provider'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '~/components/ui/accordion'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { FieldError, FieldLabel } from '~/components/ui/field'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Slider } from '~/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { colourToHex, loadFonts } from '~/lib/theme-browser'
import { firstFamily, fontChoices, fontKeys, fontStack, type FontCategory } from '~/lib/theme-fonts'
import { parseThemeCss } from '~/lib/theme-import'
import { colourGroups, type ColourKey, type ModeStyles, type ThemeModes } from '~/lib/theme-schema'
import { cn } from '~/lib/utils'

type Mode = keyof ThemeModes
type SharedKey = Exclude<keyof ModeStyles, ColourKey | 'shadow-color'>

// "sidebar-primary-foreground" as "Sidebar primary foreground".
const labelOf = (key: string) => (key.charAt(0).toUpperCase() + key.slice(1)).replaceAll('-', ' ')

// Each setting of the theme, as tweakcn's editor has them: the colours of the
// mode being edited, the fonts and letter spacing, then the radius and shadow.
// The mode being edited is the one the admin is looking at, so changes show as
// made.
export function ThemeEditor({ styles, onChange }: { styles: ThemeModes; onChange: (styles: ThemeModes) => void }) {
  const { resolvedTheme, setTheme } = useTheme()
  const mode: Mode = resolvedTheme
  const current = styles[mode]

  // A colour (and the shadow's colour) belongs to one mode.
  const setColour = (key: ColourKey | 'shadow-color', value: string) =>
    onChange({ ...styles, [mode]: { ...current, [key]: value } })
  // The rest is the same in both. A font can be unset, for the site's own.
  const setShared = (key: SharedKey, value: string | undefined) =>
    onChange({ light: { ...styles.light, [key]: value }, dark: { ...styles.dark, [key]: value } })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(value) => value && setTheme(value as Mode)}
          aria-label="Mode to edit"
        >
          <ToggleGroupItem value="light">
            <Icons.sun />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <Icons.moon />
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-sm text-muted-foreground">Colours and the shadow's colour are set for each mode.</span>
        <ImportDialog styles={styles} onImport={onChange} />
      </div>

      <Tabs defaultValue="colours">
        <TabsList variant="line">
          <TabsTrigger value="colours">Colours</TabsTrigger>
          <TabsTrigger value="typography">Typography</TabsTrigger>
          <TabsTrigger value="other">Other</TabsTrigger>
        </TabsList>
        <TabsContent value="colours" className="pt-2">
          <Accordion type="multiple" defaultValue={[colourGroups[0].title]}>
            {colourGroups.map((group) => (
              <AccordionItem key={group.title} value={group.title}>
                <AccordionTrigger>{group.title}</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4 p-1 sm:grid-cols-2">
                    {group.keys.map((key) => (
                      <ColourField
                        key={key}
                        id={`theme-${key}`}
                        label={labelOf(key)}
                        value={current[key]}
                        onChange={(value) => setColour(key, value)}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>
        <TabsContent value="typography" className="flex flex-col gap-6 pt-4">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Font family</h3>
            {(
              [
                ['sans', 'Sans-serif'],
                ['serif', 'Serif'],
                ['mono', 'Mono'],
              ] as const
            ).map(([category, label]) => (
              <FontField
                key={category}
                category={category}
                label={label}
                value={current[fontKeys[category]]}
                onChange={(value) => setShared(fontKeys[category], value)}
              />
            ))}
          </section>
          <RangeField
            label="Letter spacing"
            value={current['letter-spacing'] ?? '0em'}
            unit="em"
            min={-0.25}
            max={0.25}
            step={0.005}
            onChange={(value) => setShared('letter-spacing', value)}
          />
        </TabsContent>
        <TabsContent value="other" className="flex flex-col gap-6 pt-4">
          <RangeField
            label="Radius"
            value={current.radius ?? '0rem'}
            unit="rem"
            min={0}
            max={2}
            step={0.025}
            onChange={(value) => setShared('radius', value)}
          />
          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">Shadow</h3>
            <ColourField
              id="theme-shadow-color"
              label="Colour"
              value={current['shadow-color'] ?? 'hsl(0 0% 0%)'}
              onChange={(value) => setColour('shadow-color', value)}
            />
            <RangeField
              label="Opacity"
              value={current['shadow-opacity'] ?? '0.1'}
              unit=""
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setShared('shadow-opacity', value)}
            />
            {(
              [
                ['shadow-blur', 'Blur', 0, 50],
                ['shadow-spread', 'Spread', -50, 50],
                ['shadow-offset-x', 'Offset across', -50, 50],
                ['shadow-offset-y', 'Offset down', -50, 50],
              ] as const
            ).map(([key, label, min, max]) => (
              <RangeField
                key={key}
                label={label}
                value={current[key] ?? '0px'}
                unit="px"
                min={min}
                max={max}
                step={1}
                onChange={(value) => setShared(key, value)}
              />
            ))}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// A colour: a swatch that opens the browser's colour picker, and the value as
// CSS, for colours the picker can't show (oklch, transparency) or pasting in.
function ColourField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  // What's typed, which only becomes the colour once it is one.
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const valid = typeof CSS === 'undefined' || CSS.supports('color', text)

  return (
    <div className="flex items-end gap-2">
      <label
        className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs"
        // The colour being edited, shown as itself.
        style={{ background: value }}
      >
        <input
          type="color"
          value={colourToHex(value) ?? '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label={`Choose ${label.toLowerCase()}`}
        />
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          value={text}
          aria-invalid={!valid}
          spellCheck={false}
          className="font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value)
            if (CSS.supports('color', event.target.value)) onChange(event.target.value.trim())
          }}
          onBlur={() => setText(value)}
        />
      </div>
    </div>
  )
}

// A length (or a plain number, with no unit) on a slider. A radius given in
// pixels is shown, and saved once changed, in rem.
function RangeField({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: string
  unit: string
  min: number
  max: number
  step: number
  onChange: (value: string) => void
}) {
  const parsed = Number.parseFloat(value) || 0
  const number = unit === 'rem' && value.trim().endsWith('px') ? parsed / 16 : parsed
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {number.toFixed(decimals)}
          {unit}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={[Math.min(max, Math.max(min, number))]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(`${Number(next!.toFixed(decimals))}${unit}`)}
      />
    </div>
  )
}

// One of the theme's fonts, from tweakcn's list (see theme-fonts.ts), each
// shown in itself, as tweakcn shows them; or none, for the site's own.
function FontField({
  category,
  label,
  value,
  onChange,
}: {
  category: FontCategory
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const current = firstFamily(value)
  const id = useId()
  useEffect(() => loadFonts([current]), [current])
  useEffect(() => {
    if (open) loadFonts(fontChoices[category])
  }, [open, category])

  const choose = (font: string | undefined) => {
    onChange(font)
    setOpen(false)
  }

  return (
    <div className="grid items-center gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <span id={id} className="text-sm text-muted-foreground">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={id}
            className="justify-between font-normal"
          >
            <span className={cn('truncate', !current && 'text-muted-foreground')} style={{ fontFamily: value }}>
              {current ?? `${label} font…`}
            </span>
            <Icons.chevronDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder="Search fonts…" />
            <CommandList>
              <CommandEmpty>No fonts found.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="The site's own font" data-checked={!current} onSelect={() => choose(undefined)}>
                  The site's own font
                </CommandItem>
                {fontChoices[category].map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    data-checked={current === name}
                    style={{ fontFamily: fontStack(name, category) }}
                    onSelect={() => choose(fontStack(name, category))}
                  >
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// Pastes in a theme's CSS, as tweakcn's Code panel (or another site's
// stylesheet) has it: its :root and .dark variables replace what's here.
function ImportDialog({ styles, onImport }: { styles: ThemeModes; onImport: (styles: ThemeModes) => void }) {
  const [open, setOpen] = useState(false)
  const [css, setCss] = useState('')
  const [error, setError] = useState<string>()

  function importCss() {
    const imported = parseThemeCss(css, styles)
    if (!imported) {
      setError('No theme variables found. Paste CSS with :root { --primary: … } and .dark { … } rules.')
      return
    }
    onImport(imported)
    setOpen(false)
    setCss('')
    setError(undefined)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="ml-auto">
          <Icons.upload />
          Import CSS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a theme</DialogTitle>
          <DialogDescription>
            Paste a theme's CSS, such as tweakcn's Code panel gives. Its colours, fonts, radius, letter spacing and shadow
            replace the ones here.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={css}
          onChange={(event) => setCss(event.target.value)}
          placeholder={':root {\n  --primary: oklch(0.6 0.2 25);\n  …\n}\n.dark {\n  …\n}'}
          spellCheck={false}
          className="max-h-80 min-h-48 font-mono text-xs"
          aria-label="Theme CSS"
        />
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button type="button" onClick={importCss} disabled={!css.trim()}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
