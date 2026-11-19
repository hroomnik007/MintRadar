import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail, 30-day line (2026-11-16; since the 2026-11-19 redesign "100% uptime, N outages" beside the "Last 30 days"
// heading above the daily bars, it was in the Uptime 24h tile): it stays on one line on desktop and on
// usual phones. After the latency column was widened (#211) it wrapped at 1200px and up ("· 2 outages" on its own line).
// On the narrowest phones (below ~390px) it cannot fit half the strip at the 12px text floor; there the note moves to the
// next line whole, never broken inside.

const ALPHA = MOCK_MINTS[0]!.url

async function open(page: Page, width: number, outages: number) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: outages, outages: [] } }))
  // A 30-day uptime that rounds to 100 % with outages: the case that adds the note. Version as long as a real one.
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, uptimePct30d: 100, version: 'Nutshell/0.16.0' } : m) }))
  await resize(page, width, width < 769 ? 844 : 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.getByTestId('md-uptime-30d')).toContainText(`${outages} outage`)
  await layoutReady(page)
}

/** Number of lines the element's text takes (its height over its line height). */
const lines = (page: Page, sel: string) => page.locator(sel).first().evaluate(e => {
  const lh = parseFloat(getComputedStyle(e).lineHeight)
  return Math.round(e.getBoundingClientRect().height / lh)
})

for (const outages of [2, 12]) {
  for (const width of [769, 900, 1024, 1199, 1200, 1250, 1280, 1366, 1440, 1600, 390, 414, 430]) {
    test(`${width}px, ${outages} outages: "100% uptime, ${outages} outages" is one line`, async ({ page }) => {
      await open(page, width, outages)
      expect(await lines(page, '[data-testid="md-uptime-30d"]')).toBe(1)
      // The other figures keep their own rules: Version on one line, nothing clipped in the strip.
      const version = page.locator('.md-sc-software .md-strip-code')
      expect(await version.evaluate(el => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 2)).toBe(true)
      const clipped = await page.locator('.md-summary *').evaluateAll(els => els.filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).length)
      expect(clipped).toBe(0)
    })
  }
}

for (const width of [320, 360, 375]) {
  test(`${width}px, 12 outages: the note is never broken inside`, async ({ page }) => {
    await open(page, width, 12)
    expect(await lines(page, '.md-uptime-30d-note')).toBe(1)
    expect(await lines(page, '[data-testid="md-uptime-30d"]')).toBeLessThanOrEqual(2)
  })
}
