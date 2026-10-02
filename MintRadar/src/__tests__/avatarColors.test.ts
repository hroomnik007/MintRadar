import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { REVIEW_AVATAR_COLORS, AVATAR_TEXT_DARK, AVATAR_TEXT_LIGHT, avatarTextColor, hexLuminance, reviewAvatarColor } from '@/utils/avatarColors'

// Runs the colour choice over every tile colour the code can produce and asserts WCAG contrast,
// with the real token values read from src/index.css (so a palette change is caught here).

type Rgb = [number, number, number]
const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
const rootBlock = /:root\s*{([\s\S]*?)\n}/.exec(css)![1]!
const rawTokens = new Map<string, string>()
for (const m of rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)) rawTokens.set(m[1]!, m[2]!.trim())

function tokenRgba(name: string): [number, number, number, number] {
  const v = rawTokens.get(name)
  if (!v) throw new Error(`token --${name} not found`)
  const alias = /^var\(--([\w-]+)\)$/.exec(v)
  if (alias) return tokenRgba(alias[1]!)
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) { const n = parseInt(hex[1]!, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1] }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v)
  if (rgba) { const p = rgba[1]!.split(',').map(Number); return [p[0]!, p[1]!, p[2]!, p[3] ?? 1] }
  throw new Error(`cannot parse --${name}: ${v}`)
}
const rgb = (name: string): Rgb => tokenRgba(name).slice(0, 3) as Rgb
const mix = (a: Rgb, b: Rgb, pa: number): Rgb => [0, 1, 2].map(i => a[i]! * pa + b[i]! * (1 - pa)) as Rgb
const over = (top: [number, number, number, number], below: Rgb): Rgb => [0, 1, 2].map(i => top[i]! * top[3] + below[i]! * (1 - top[3])) as Rgb
const lum = ([r, g, b]: Rgb) => {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a: Rgb, b: Rgb) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05) }
const hexRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

/** Resolve `color-mix(in srgb, A p%, B)` where A/B are var(--token) or the keyword black. */
function resolveMix(value: string): Rgb {
  const m = /^color-mix\(in srgb,\s*(var\(--[\w-]+\)|black)\s+(\d+)%,\s*(var\(--[\w-]+\)|black)\)$/.exec(value)
  if (!m) throw new Error(`unexpected colour expression: ${value}`)
  const side = (s: string): Rgb => (s === 'black' ? [0, 0, 0] : rgb(/--([\w-]+)/.exec(s)![1]!))
  return mix(side(m[1]!), side(m[3]!), Number(m[2]) / 100)
}
const textRgb = (value: string): Rgb => (value.startsWith('color-mix') ? resolveMix(value) : rgb(/--([\w-]+)/.exec(value)![1]!))

describe('review avatar initials', () => {
  it('has the six-colour palette this test covers', () => {
    expect(REVIEW_AVATAR_COLORS).toHaveLength(6)
  })

  it.each([...REVIEW_AVATAR_COLORS])('initial on %s reaches 4.5:1', tile => {
    expect(ratio(textRgb(avatarTextColor(tile)), hexRgb(tile))).toBeGreaterThanOrEqual(4.5)
  })

  it('picks light text on dark tiles and dark text on light tiles', () => {
    expect(avatarTextColor('#101010')).toBe(AVATAR_TEXT_LIGHT)
    expect(avatarTextColor('#ffffff')).toBe(AVATAR_TEXT_DARK)
    expect(ratio(textRgb(AVATAR_TEXT_LIGHT), hexRgb('#101010'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(textRgb(AVATAR_TEXT_DARK), hexRgb('#ffffff'))).toBeGreaterThanOrEqual(4.5)
  })

  it('maps any pubkey to a palette colour (also non-hex input)', () => {
    expect(REVIEW_AVATAR_COLORS as readonly string[]).toContain(reviewAvatarColor('zzzz'))
    expect(REVIEW_AVATAR_COLORS as readonly string[]).toContain(reviewAvatarColor('0'.repeat(64)))
    expect(hexLuminance('#000000')).toBe(0)
  })
})

describe('mint monogram (MintFavicon fallback) initials', () => {
  const placeholder = render(createElement(MintFavicon, { url: 'https://minibits.cash', iconUrl: null })).getByLabelText(/placeholder/)
  const colour = (placeholder as HTMLElement).style.color

  // Every surface token the tile can sit on (card, page, panels, raised) + the dimmed-offline card surface.
  const surfaces: [string, Rgb][] = ['bg', 'surface', 'elevated', 'raised', 'surface-card'].map(n => [n, rgb(n)] as [string, Rgb])
  surfaces.push(['offline card', mix(rgb('surface-card'), rgb('bg'), 0.72)])

  it('uses a colour built from theme tokens', () => {
    expect(colour).toMatch(/^color-mix\(in srgb, var\(--copper\) \d+%, var\(--text\)\)$/)
  })

  it.each(surfaces)('initial reaches 4.5:1 on the tile over %s', (_name, surface) => {
    const tile = over(tokenRgba('copper-soft'), surface)
    expect(ratio(resolveMix(colour), tile)).toBeGreaterThanOrEqual(4.5)
  })
})
