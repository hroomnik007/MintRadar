import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The compact Reliability tile on Mint Detail (mobile, <= 640px) shows "High / Moderate / Low Reliability" in a
// badge beside the donut. The column beside the donut is only ~62-95px wide, and the badge used to be one
// nowrap line cut by the tile's overflow:hidden ("High Relial" at 320px). It now wraps inside the column: the
// badge box lies inside its column and its tile, and no part of its text is clipped.

const LABELS = [['High Reliability', 92], ['Moderate Reliability', 55], ['Low Reliability', 20]] as const
const known = LABELS.map(([, score], i) => ({ ...MOCK_KNOWN_MINTS[0]!, url: `https://badge${i}.mint.example`, name: `Badge ${i}`, online: true, reliabilityScore: score }))

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: known }))
})

for (const width of [320, 360, 390]) {
  LABELS.forEach(([label], i) => {
    test(`"${label}" fits its column and tile at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/mint/${encodeURIComponent(known[i]!.url)}`)
      const badge = page.locator('.md-sc-reliability-badge')
      await expect(badge).toHaveText(label)
      const m = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as HTMLElement
        const b = q('.md-sc-reliability-badge'), meta = q('.md-sc-reliability-meta'), tile = q('.md-sc-reliability')
        const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right } }
        const range = document.createRange(); range.selectNodeContents(b)
        const lines = Array.from(range.getClientRects()).map(r => ({ l: r.left, r: r.right }))
        return { badge: rect(b), meta: rect(meta), tile: rect(tile), lines, scrollW: b.scrollWidth, clientW: b.clientWidth, sideScroll: document.documentElement.scrollWidth > innerWidth }
      })
      const eps = 0.5
      expect(m.badge.l).toBeGreaterThanOrEqual(m.meta.l - eps)
      expect(m.badge.r).toBeLessThanOrEqual(m.meta.r + eps)
      expect(m.badge.r).toBeLessThanOrEqual(m.tile.r + eps)
      // every rendered text line lies inside the column (nothing is cut by overflow:hidden) and the badge does not overflow itself
      for (const line of m.lines) {
        expect(line.l).toBeGreaterThanOrEqual(m.meta.l - eps)
        expect(line.r).toBeLessThanOrEqual(m.meta.r + eps)
      }
      expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1)
      expect(m.sideScroll).toBe(false)
    })
  })
}
