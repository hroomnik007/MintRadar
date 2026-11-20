import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The Reliability Score words on Mint Detail phones. Until the 2026-11-19 redesign a compact donut tile showed
// "High / Moderate / Low Reliability" in a narrow badge that was once cut ("High Relial" at 320px). Since the redesign the
// score tile spans the strip's first row: the number, then its words beside it. The words lie inside the tile, unclipped.

// The band word alone since 2026-11-19 (owner): "High. Operational health, not solvency."
const LABELS = [['High.', 92], ['Moderate.', 55], ['Low.', 20]] as const
const known = LABELS.map(([, score], i) => ({ ...MOCK_KNOWN_MINTS[0]!, url: `https://badge${i}.mint.example`, name: `Badge ${i}`, online: true, reliabilityScore: score }))

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: known }))
})

for (const width of [320, 360, 390]) {
  LABELS.forEach(([label], i) => {
    test(`"${label}" fits the score tile at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/mint/${encodeURIComponent(known[i]!.url)}`)
      const words = page.locator('.md-sc-score .md-sc-sub > span').first()
      await expect(words).toContainText(label)
      const m = await page.evaluate(() => {
        const tile = document.querySelector('.md-sc-score') as HTMLElement
        const b = tile.querySelector('.md-sc-sub > span') as HTMLElement
        const r = tile.getBoundingClientRect(), pad = parseFloat(getComputedStyle(tile).paddingRight)
        const range = document.createRange(); range.selectNodeContents(b)
        const lines = Array.from(range.getClientRects()).map(x => ({ l: x.left, r: x.right }))
        return { tileL: r.left, tileR: r.right - pad, lines, scrollW: b.scrollWidth, clientW: b.clientWidth, sideScroll: document.documentElement.scrollWidth > innerWidth }
      })
      const eps = 0.5
      for (const line of m.lines) {
        expect(line.l).toBeGreaterThanOrEqual(m.tileL - eps)
        expect(line.r).toBeLessThanOrEqual(m.tileR + eps)
      }
      expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1)
      expect(m.sideScroll).toBe(false)
    })
  })
}
