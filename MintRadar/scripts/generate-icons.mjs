// Regenerates every raster brand asset from the two SVG sources (run from the MintRadar/ app folder):
//   node scripts/generate-icons.mjs
//   public/favicon.svg    -> public/favicon-16x16.png, favicon-32x32.png, favicon.ico (32x32 PNG in an ICO),
//                            icons/icon-{72,96,128,144,152,192,384,512}x*.png (rounded tile, transparent corners),
//                            apple-touch-icon.png (180x180, opaque --bg, no corner rounding: iOS masks it itself)
//   public/og-image.svg   -> public/og-image.png (1200x630)
// The OG text uses `font-family: monospace`; the committed PNG was rasterised with DejaVu Sans Mono. Point
// FONTCONFIG_FILE at a fontconfig that aliases monospace -> DejaVu Sans Mono (see
// docs/claude/design-palette-and-chrome.md, "Brand assets"), otherwise the machine's default monospace is used.
import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const BG = '#0b1512' // --bg
const faviconSvg = readFileSync('public/favicon.svg')

// The SVG is authored on a 32px grid: render it at density 72 * size / 32 so strokes stay crisp at any size.
const renderFavicon = (size) =>
  sharp(faviconSvg, { density: (72 * size) / 32 }).resize(size, size).png()

mkdirSync('public/icons', { recursive: true })

// Every size the manifest references must be listed here (pinned by src/__tests__/brandAssets.test.ts).
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
for (const size of ICON_SIZES) {
  await renderFavicon(size).toFile(`public/icons/icon-${size}x${size}.png`)
  console.log(`Generated icon-${size}x${size}.png`)
}

await renderFavicon(16).toFile('public/favicon-16x16.png')
const favicon32 = await renderFavicon(32).toBuffer()
writeFileSync('public/favicon-32x32.png', favicon32)

// favicon.ico: one 32x32 image, stored as PNG (supported by every browser that reads .ico favicons).
const ico = Buffer.alloc(22)
ico.writeUInt16LE(0, 0) // reserved
ico.writeUInt16LE(1, 2) // type: icon
ico.writeUInt16LE(1, 4) // image count
ico.writeUInt8(32, 6) // width
ico.writeUInt8(32, 7) // height
ico.writeUInt16LE(1, 10) // colour planes
ico.writeUInt16LE(32, 12) // bits per pixel
ico.writeUInt32LE(favicon32.length, 14) // image size
ico.writeUInt32LE(22, 18) // image offset
writeFileSync('public/favicon.ico', Buffer.concat([ico, favicon32]))

// apple-touch-icon: the same artwork on an opaque --bg square (iOS applies its own corner mask).
await renderFavicon(180).flatten({ background: BG }).png().toFile('public/apple-touch-icon.png')

await sharp(readFileSync('public/og-image.svg')).resize(1200, 630).png().toFile('public/og-image.png')
console.log('Done.')
