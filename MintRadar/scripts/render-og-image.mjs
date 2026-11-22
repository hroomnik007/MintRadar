// Renders scripts/og-image/og-image-mintradar.html to public/og-image-mintradar.png (1200x630) with Playwright's
// Chromium (already a dev dependency for the e2e tests), so the image uses the site's own MintRadar Sans files.
// Run from MintRadar/: node scripts/render-og-image.mjs
import { chromium } from '@playwright/test'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(resolve('scripts/og-image/og-image-mintradar.html')).href)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: 'public/og-image-mintradar.png', clip: { x: 0, y: 0, width: 1200, height: 630 } })
await browser.close()
console.log('public/og-image-mintradar.png')
