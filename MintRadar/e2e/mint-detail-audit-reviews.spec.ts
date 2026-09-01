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

test('Audit tab: Recent reliability card matches the Trust Score breakdown', async ({ page }) => {
  await page.locator('.md-tab', { hasText: 'Audit' }).click()

  const card = page.locator('.audit-recent-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Recent reliability')
  await expect(card).toContainText('last ~100 swaps')
  await expect(card.locator('.audit-recent-value')).toHaveText('3 / 100 · 97%')

  // It must sit apart from the all-time cards, and the footer must name the split.
  await expect(page.locator('.audit-stats-grid .audit-stat-card')).toHaveCount(3)
  await expect(page.locator('.md-audit-content')).toContainText('all-time totals from audit.8333.space')

  await page.locator('.audit-recent-card').scrollIntoViewIfNeeded()
  await page.locator('.md-audit-content').screenshot({ path: 'test-results/audit-recent-card.png' })

  // Cross-check against the sidebar Trust Score breakdown — same 3/100 window.
  await page.locator('.md-trust-panel').getByText('Details ›').click()
  await expect(page.getByText('Trust Score Breakdown')).toBeVisible()
  await expect(page.getByText('Audit reliability (5%)')).toBeVisible()
  await expect(page.getByText('3.0% err')).toBeVisible() // 3/100 → same source as the card's 97%
  await page.screenshot({ path: 'test-results/audit-breakdown-crosscheck.png' })
})
