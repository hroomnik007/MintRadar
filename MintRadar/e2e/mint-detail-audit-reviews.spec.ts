import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

// Give Alpha a populated rolling-window audit sample (3 errors / 100 swaps).
const KNOWN_WITH_RECENT = MOCK_KNOWN_MINTS.map((m, i) =>
  i === 0 ? { ...m, auditRecentTotal: 100, auditRecentErrors: 3 } : m,
)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', route => route.fulfill({ json: KNOWN_WITH_RECENT }))
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
})

test('Audit tab: summary strip "Recent errors" matches the Trust Score breakdown', async ({ page }) => {
  await page.locator('.md-tab', { hasText: 'Audit' }).click()

  const strip = page.locator('.audit-summary-strip')
  await expect(strip).toBeVisible()

  const recentCell = strip.locator('.audit-summary-cell', { hasText: 'Recent errors' })
  await expect(recentCell.locator('.audit-summary-main')).toHaveText('3 / 100')
  await expect(recentCell.locator('.audit-summary-sub')).toHaveText('97% ok')

  // The all-time line carries the lifetime totals without duplicating them as cards.
  await expect(page.locator('.audit-alltime-line')).toContainText('100 mints · 50 melts · 0 errors')

  await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-summary-strip.png' })

  // Cross-check against the sidebar Trust Score breakdown — same 3/100 window.
  await page.locator('.md-trust-panel').getByText('Details ›').click()
  await expect(page.getByText('Trust Score Breakdown')).toBeVisible()
  await expect(page.getByText('Audit reliability (5%)')).toBeVisible()
  await expect(page.getByText('3.0% err')).toBeVisible() // 3/100 → same source as the strip's 97% ok
  await page.screenshot({ path: 'test-results/audit-breakdown-crosscheck.png' })
})
