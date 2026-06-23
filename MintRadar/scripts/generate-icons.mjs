import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'fs'

const sizes = [72, 96, 128, 152, 192, 384, 512]
const input = 'public/logo-original.png'

mkdirSync('public/icons', { recursive: true })

for (const size of sizes) {
  await sharp(input)
    .resize(size, size, { fit: 'contain', background: { r: 10, g: 10, b: 10, alpha: 1 } })
    .png()
    .toFile(`public/icons/icon-${size}x${size}.png`)
  console.log(`Generated icon-${size}x${size}.png`)
}

await sharp(input).resize(32, 32).png().toFile('public/favicon-32x32.png')
await sharp(input).resize(16, 16).png().toFile('public/favicon-16x16.png')
await sharp(input).resize(180, 180).png().toFile('public/apple-touch-icon.png')
console.log('Done.')
