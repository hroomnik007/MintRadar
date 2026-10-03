// Guards the brand assets (docs/claude/design-palette-and-chrome.md, "Brand assets"): the browser chrome colour,
// manifest colours, favicon and OG image must stay on the current tokens, and the rasters must keep their sizes.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const tokens = read('src/index.css')
const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(tokens)?.[1]?.toLowerCase()
const BG = token('bg')
const ACCENT = token('accent')

const RETIRED = ['#0A0A0A', '#00E676', '#0B0C11', '#111318', '#161B22', '#1E2229', '#AAB4C7', '#444B5A']

// PNG IHDR: width/height are the big-endian uint32s at byte 16 and 20.
function pngSize(p: string) {
  const b = fs.readFileSync(path.join(ROOT, p))
  expect(b.subarray(1, 4).toString('ascii'), p).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('brand assets', () => {
  it('reads the current tokens', () => {
    expect(BG).toBe('#0b1512')
    expect(ACCENT).toBe('#5cc9a3')
  })

  it('theme-color and the manifest colours equal --bg', () => {
    expect(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(read('index.html'))?.[1]?.toLowerCase()).toBe(BG)
    const cfg = read('vite.config.ts')
    expect(/theme_color:\s*'(#[0-9a-fA-F]{6})'/.exec(cfg)?.[1]?.toLowerCase()).toBe(BG)
    expect(/background_color:\s*'(#[0-9a-fA-F]{6})'/.exec(cfg)?.[1]?.toLowerCase()).toBe(BG)
  })

  it('favicon.svg and og-image.svg carry no retired colour and use the accent', () => {
    for (const f of ['public/favicon.svg', 'public/og-image.svg', 'public/og-image-reliability.svg']) {
      const svg = read(f).toLowerCase()
      for (const c of RETIRED) expect(svg, `${f} ${c}`).not.toContain(c.toLowerCase())
      expect(svg, f).toContain(ACCENT)
    }
    expect(read('public/favicon.svg').toLowerCase()).toContain(`fill="${BG}"`)
  })

  it('raster sizes are unchanged', () => {
    expect(pngSize('public/favicon-16x16.png')).toEqual([16, 16])
    expect(pngSize('public/favicon-32x32.png')).toEqual([32, 32])
    expect(pngSize('public/apple-touch-icon.png')).toEqual([180, 180])
    expect(pngSize('public/og-image.png')).toEqual([1200, 630])
    expect(pngSize('public/og-image-reliability.png')).toEqual([1200, 630])
    for (const s of [72, 96, 128, 144, 152, 192, 384, 512]) expect(pngSize(`public/icons/icon-${s}x${s}.png`)).toEqual([s, s])
  })

  describe('icons directory', () => {
    const generatorSizes = (/const ICON_SIZES = \[([\d,\s]+)\]/.exec(read('scripts/generate-icons.mjs'))?.[1] ?? '')
      .split(',').map(n => Number(n.trim())).filter(Boolean)
    const files = fs.readdirSync(path.join(ROOT, 'public/icons'))

    it('every file is icon-<N>x<N>.png, listed in the generator, with matching dimensions', () => {
      expect(generatorSizes.length).toBeGreaterThan(0)
      for (const f of files) {
        const m = /^icon-(\d+)x(\d+)\.png$/.exec(f)
        expect(m, `${f} does not match icon-<N>x<N>.png`).not.toBeNull()
        const n = Number(m?.[1])
        expect(m?.[2]).toBe(m?.[1])
        expect(generatorSizes, f).toContain(n)
        expect(pngSize(`public/icons/${f}`), f).toEqual([n, n])
      }
    })

    it('the generator produces every file present and everything the manifest references', () => {
      expect(files.map(f => Number(/^icon-(\d+)x/.exec(f)?.[1])).sort((a, b) => a - b)).toEqual([...generatorSizes].sort((a, b) => a - b))
      const manifest = [...read('vite.config.ts').matchAll(/icon\(command, '\/icons\/icon-(\d+)x\d+\.png'\)/g)].map(m => Number(m[1]))
      expect(manifest.length).toBeGreaterThan(0)
      for (const n of manifest) expect(generatorSizes).toContain(n)
    })
  })

  it('favicon.ico is a single 32x32 image', () => {
    const b = fs.readFileSync(path.join(ROOT, 'public/favicon.ico'))
    expect([b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4), b[6], b[7]]).toEqual([0, 1, 1, 32, 32])
  })
})
