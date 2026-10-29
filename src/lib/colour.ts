// CSS colours as the "H S% L%" triplets the mobile app's styles take (see
// mobile-api.server.ts): React Native can't draw oklch(), which most theme
// presets use. Handles what themes are written in: hex, rgb(), hsl() and
// oklch(). Transparency is dropped.

type Rgb = [number, number, number]

const clamp = (n: number) => Math.min(1, Math.max(0, n))

// "50%" → 0.5 of `scale`, "0.5" → 0.5 (or 0.5 of 255 for rgb, as given).
function number(part: string, percentOf = 1) {
  const n = Number.parseFloat(part)
  if (!Number.isFinite(n)) return null
  return part.trim().endsWith('%') ? (n / 100) * percentOf : n
}

function hue(part: string) {
  const n = Number.parseFloat(part)
  if (!Number.isFinite(n)) return null
  if (part.endsWith('turn')) return n * 360
  if (part.endsWith('rad')) return (n * 180) / Math.PI
  return n
}

// "rgb(1 2 3 / 50%)", "rgb(1, 2, 3)", "hsla(…)": the parts before any alpha.
function args(value: string, name: string) {
  const match = new RegExp(`^${name}a?\\((.*)\\)$`, 'i').exec(value)
  if (!match) return null
  const parts = match[1]!.split('/')[0]!.trim().split(/[\s,]+/).filter(Boolean)
  return parts.length >= 3 ? parts : null
}

function hexToRgb(value: string): Rgb | null {
  const hex = /^#([\da-f]{3,8})$/i.exec(value)?.[1]
  if (!hex || ![3, 4, 6, 8].includes(hex.length)) return null
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as Rgb
}

function oklchToRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  // Out-of-gamut colours are clipped, as browsers roughly do.
  return linear.map((x) => {
    const v = clamp(x)
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }) as Rgb
}

function rgbToHsl([r, g, b]: Rgb) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}

function toHsl(value: string) {
  const colour = value.trim().toLowerCase()
  if (colour.startsWith('#')) {
    const rgb = hexToRgb(colour)
    return rgb && rgbToHsl(rgb)
  }
  const rgb = args(colour, 'rgb')
  if (rgb) {
    const parts = rgb.slice(0, 3).map((part) => number(part, 255))
    return parts.every((n) => n !== null) ? rgbToHsl(parts.map((n) => clamp(n! / 255)) as Rgb) : null
  }
  const hsl = args(colour, 'hsl')
  if (hsl) {
    const [h, s, l] = [hue(hsl[0]!), number(hsl[1]!, 1), number(hsl[2]!, 1)]
    if (h === null || s === null || l === null) return null
    // hsl(0 0% 50%) gives fractions; hsl(0 0 50) (numbers alone) means percent.
    return { h, s: hsl[1]!.endsWith('%') ? s : s / 100, l: hsl[2]!.endsWith('%') ? l : l / 100 }
  }
  const oklch = args(colour, 'oklch')
  if (oklch) {
    const [l, c, h] = [number(oklch[0]!, 1), number(oklch[1]!, 0.4), oklch[2] === 'none' ? 0 : hue(oklch[2]!)]
    return l === null || c === null || h === null ? null : rgbToHsl(oklchToRgb(l, c, h))
  }
  return null
}

const round = (n: number) => Math.round(n * 10) / 10

// "oklch(0.6489 0.237 26.97)" → "0 100% 60%"; null for what isn't a colour
// this understands.
export function cssColourToHslTriplet(value: string) {
  const hsl = toHsl(value)
  if (!hsl) return null
  const h = round(((hsl.h % 360) + 360) % 360)
  return `${h === 360 ? 0 : h} ${round(clamp(hsl.s) * 100)}% ${round(clamp(hsl.l) * 100)}%`
}
