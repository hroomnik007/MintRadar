import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await expect(page.locator('.mint-card')).toHaveCount(4)
})

test.describe('Compare (Mint Diff Tool)', () => {
  test('opens the comparison modal with historical trends and version history', async ({ page }) => {
    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()

    await expect(page.getByText('Compare with...')).toBeVisible()
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()

    // Existing current-state comparison (unchanged behavior).
    await expect(page.getByText('Mint Comparison')).toBeVisible()
    await expect(page.locator('.cmp-lbl', { hasText: 'Trust Score' })).toBeVisible()

    // New: Historical Trends section with chart controls.
    await expect(page.getByText('Historical Trends')).toBeVisible()
    await expect(page.locator('button', { hasText: 'Uptime' })).toBeVisible()
    await expect(page.locator('button', { hasText: '90d' })).toBeVisible()

    // New: Software Version History section, per-mint.
    await expect(page.getByText('Software Version History')).toBeVisible()
    await expect(page.locator('.cmp-lbl', { hasText: 'Versions' })).toBeVisible()

    // Current-state note clarifying NUT Support isn't tracked historically.
    await expect(page.getByText(/does not track over time/)).toBeVisible()
  })

  test('shows Trust Score and Community Rating rows, with a fallback for mints without reviews', async ({ page }) => {
    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()
    await page.locator('.md-picker-item', { hasText: 'Bravo Mint' }).click()
    await page.locator('.md-picker-confirm').click()

    await expect(page.getByText('Mint Comparison')).toBeVisible()

    const grid = page.locator('.cmp-grid')
    await expect(grid.locator('.cmp-lbl', { hasText: 'Trust Score' })).toBeVisible()
    await expect(grid.locator('.cmp-lbl', { hasText: 'Community Rating' })).toBeVisible()

    // Alpha has 12 reviews averaging 4.2 → star badge; Bravo has none → "—".
    await expect(grid.getByText('4.2')).toBeVisible()
    await expect(grid.getByText('(12)')).toBeVisible()
    await expect(grid.locator('.cmp-val', { hasText: '—' }).first()).toBeVisible()
  })

  test('stacks charts vertically instead of overlaying on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    // The shared history fixture has only one bucket, which is below the
    // 2-bucket floor ComparisonModal requires before it renders a chart at
    // all ("Not enough data for this period" otherwise) — supply two here so
    // the chart section actually renders instead of the empty-state message.
    await page.route('**/api/mints/history**', route => route.fulfill({
      json: {
        period: '7d',
        segments: [
          { bucket: '2026-08-28T00:00:00Z', online: true, latencyMs: 50, total: 12, onlineCount: 12, uptimePct: 100, trustScore: 92 },
          { bucket: '2026-08-29T00:00:00Z', online: true, latencyMs: 55, total: 12, onlineCount: 12, uptimePct: 100, trustScore: 92 },
        ],
        uptimePct: 99, avgLatencyMs: 52, prevUptimePct: 98, prevAvgLatencyMs: 60,
        earliestCheckedAt: '2026-08-01T00:00:00Z', daysOfDataAvailable: 7, periodDays: 7,
        prevPeriodInsufficientHistory: false,
      },
    }))
    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()

    await expect(page.getByText('Historical Trends')).toBeVisible()
    // Mobile layout renders one mini chart per mint with its name as a heading,
    // rather than a single overlaid multi-line chart. (The mobile stacked
    // comparison table above also renders each mint's name — in a tab and in
    // the active mint's header — so scope this to the chart heading specifically.)
    const modal = page.locator('.cmp-modal')
    await expect(modal.locator('.cmp-mobile-chart-name')).toHaveCount(2)
    await expect(modal.locator('.cmp-mobile-chart-name', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(modal.locator('.cmp-mobile-chart-name', { hasText: 'Delta Mint' })).toBeVisible()
  })
})
