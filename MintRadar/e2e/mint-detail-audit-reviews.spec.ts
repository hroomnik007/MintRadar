import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

// Give Alpha the cashu.info 7-day window that feeds the Reliability Score's audit row (1 attributed of 50 swaps), next
// to a populated audit.8333.space window (3 errors / 100 swaps) that the page must ignore.
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

test('the Reliability Score breakdown row shows the cashu.info 7-day window', async ({ page }) => {
  // 1 attributed failure of 50 → 49 / 50 without one, as in Compare. The breakdown is always visible inline on the
  // Overview sidebar panel.
  const reliabilityPanel = page.locator('.md-reliability-panel')
  await expect(reliabilityPanel.getByText('Audit reliability (25%)')).toBeVisible()
  await expect(reliabilityPanel.getByText('49 / 50')).toBeVisible()
  await expect(reliabilityPanel.getByText('3.0% err')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/audit-breakdown-crosscheck.png' })
})
