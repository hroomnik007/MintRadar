import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

// Give Alpha a populated audit.8333.space rolling window (3 errors / 100 swaps, Audit tab) and, separately,
// the cashu.info 7-day window that feeds the Reliability Score's audit row (1 attributed of 50 swaps).
const KNOWN_WITH_RECENT = MOCK_KNOWN_MINTS.map((m, i) =>
  i === 0 ? { ...m, auditRecentTotal: 100, auditRecentErrors: 3, auditCzTotal: 50, auditCzBlamed: 1, auditCzFetchedAt: new Date(Date.now() - 3_600_000).toISOString() } : m,
)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', route => route.fulfill({ json: KNOWN_WITH_RECENT }))
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
})

test('Audit tab strip shows the audit.8333.space window; the Reliability Score breakdown row shows the cashu.info window', async ({ page }) => {
  await page.locator('.md-tab', { hasText: 'Audit' }).click()

  const strip = page.locator('.audit-summary-strip')
  await expect(strip).toBeVisible()

  const recentCell = strip.locator('.audit-summary-cell', { hasText: 'Recent success rate' })
  // 3 errors / 100 swaps → the strip's main number is successes, not errors.
  await expect(recentCell.locator('.audit-summary-main')).toHaveText('97 / 100')
  await expect(recentCell.locator('.audit-summary-sub')).toHaveText('97% ok')

  // The all-time body paragraphs were removed — only the heading, the four stat
  // tiles and their ⓘ tooltips remain.
  await expect(page.locator('.audit-alltime-line')).toHaveCount(0)
  await expect(page.locator('.audit-tab-explainer')).toHaveCount(0)

  await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-summary-strip.png' })

  // The sidebar Reliability Score breakdown reads the cashu.info 7-day window instead (1 of 50), not the strip's 3/100.
  // The breakdown is always visible inline on the Overview sidebar panel now
  // (no "Details ›" click needed).
  const reliabilityPanel = page.locator('.md-reliability-panel')
  await expect(reliabilityPanel.getByText('Audit reliability (25%)')).toBeVisible()
  await expect(reliabilityPanel.getByText('1 of 50 swaps in the last 7 days had a failure attributed to this mint (cashu.info)')).toBeVisible()
  await expect(reliabilityPanel.getByText('3.0% err')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/audit-breakdown-crosscheck.png' })
})
