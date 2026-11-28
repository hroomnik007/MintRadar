import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { cmpOpenFold, cmpValues } from './fixtures/compare'

// Compare modal basics after the 2026-11-28 redesign: the cards and sections, the community rating, and the folded
// History panel (one chart with a legend naming each mint, on every width, plus the software versions per mint).

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
})

const TWO_BUCKETS = {
  period: '7d',
  segments: [
    { bucket: '2026-08-28T00:00:00Z', online: true, latencyMs: 50, total: 12, onlineCount: 12, uptimePct: 100, reliabilityScore: 92 },
    { bucket: '2026-08-29T00:00:00Z', online: true, latencyMs: 55, total: 12, onlineCount: 12, uptimePct: 100, reliabilityScore: 92 },
  ],
  uptimePct: 99, avgLatencyMs: 52, prevUptimePct: 98, prevAvgLatencyMs: 60,
  earliestCheckedAt: '2026-08-01T00:00:00Z', daysOfDataAvailable: 7, periodDays: 7, prevPeriodInsufficientHistory: false,
}

async function compareWith(page: import('@playwright/test').Page, other: string) {
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await expect(page.getByText(/^Compare with /)).toBeVisible()
  await page.locator('.md-picker-item', { hasText: other }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
}

test.describe('Compare (Mint Diff Tool)', () => {
  test('cards, sections, and a folded History with its controls and the software versions', async ({ page }) => {
    await compareWith(page, 'Delta Mint')
    await expect(page.locator('[data-testid="cmp-card"]')).toHaveCount(2)
    // C1 (2026-11-28): "97 /100" (the words for screen readers), the 30-day bars at the bottom of each card
    await expect(page.locator('[data-testid="cmp-card"] .cx-score-lbl [aria-hidden="true"]').first()).toHaveText('/100')
    await expect(page.locator('[data-testid="cmp-card"] .cx-score-lbl .sr-only').first()).toHaveText('Reliability Score out of 100')
    await expect(page.locator('[data-testid="cmp-card"]').first().getByTestId('cmp-days')).toBeVisible()
    // C4: no "N mints side by side", the differences sentence only for screen readers
    await expect(page.getByText(/mints side by side/)).toHaveCount(0)
    await expect(page.locator('.cmp-m-status')).toHaveClass(/sr-only/)
    await expect(page.locator('.cx-h')).toHaveText(['Reliability', 'Latency', 'Deposits and withdrawals', 'Features', 'Operator'])
    // No "Measure again": the browser latency is measured once, when Compare opens.
    await expect(page.getByTestId('cmp-remeasure')).toHaveCount(0)

    const history = page.locator('details.cx-fold', { has: page.locator('summary', { hasText: 'History' }) })
    await expect(history).not.toHaveAttribute('open', '')
    await cmpOpenFold(page, 'History')
    for (const name of ['Latency', 'Uptime', 'Score', '24 h', '7 d', '30 d', '90 d']) {
      await expect(history.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(history.getByRole('button', { name: '7 d', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(history.locator('.cx-row[data-row="versions"] .cx-lbl')).toHaveText('Software versions')
  })

  test('community rating: stars with the count, "—" for a mint without reviews, never a BEST tag', async ({ page }) => {
    await compareWith(page, 'Bravo Mint')
    // Alpha has 12 reviews averaging 4.2; Bravo has none.
    expect(await cmpValues(page, 'rating')).toEqual(['★ 4.2 (12)', '—'])
    await expect(page.locator('.cx-val[data-row="rating"] .cmp-best')).toHaveCount(0)
  })

  test('History on a phone: one chart, its legend names every mint in its line colour', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.route('**/api/mints/history**', route => route.fulfill({ json: TWO_BUCKETS }))
    await compareWith(page, 'Delta Mint')
    await cmpOpenFold(page, 'History')
    const modal = page.locator('.cmp-modal')
    await expect(modal.locator('.recharts-responsive-container')).toHaveCount(1)
    await expect(modal.locator('.cx-legend-item')).toHaveText(['Alpha Mint', 'Delta Mint'])
    const colours = await modal.locator('.cx-legend-line').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))
    expect(new Set(colours).size).toBe(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  })
})
