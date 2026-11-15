import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// UI/UX follow-ups of 2026-11-14: the phone list view shows the rating like the cards do.
// Method filter labels are bolt11, bolt12 and On-chain; ?method= stays the protocol name.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('390px list view: Rating is a column next to Reliability (default sort)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mintRadar_viewMode', 'list'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const header = page.locator('.mint-list-table thead th:visible')
  await expect(header).toHaveText(['Mint', 'Status', 'Uptime 24h', 'Reliability', 'Rating'])
  const alpha = page.locator('.mint-list-row', { hasText: 'Alpha Mint' })
  await expect(alpha.locator('td.rating-col')).toBeVisible()
  await expect(alpha.locator('td.rating-col')).toContainText('4.2')
  await expect(alpha.locator('td.rating-col [aria-label]')).toHaveAttribute('aria-label', '4.2 out of 5, 12 reviews')
  // The rows fit the phone: the table does not scroll sideways at 390px.
  expect(await page.locator('.mint-list-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('method filter: bolt11, bolt12 and On-chain; ?method= stays the protocol name', async ({ page }) => {
  const m = (method: string) => ({ method, unit: 'sat', min_amount: 1, max_amount: 1000 })
  const rows = MOCK_KNOWN_MINTS.map((x, i) => (i === 0
    ? { ...x, mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('onchain')], nutsLimits: { '4': {}, '5': {} } }
    : { ...x, mintMethods: [m('bolt11')], meltMethods: [m('bolt11')], nutsLimits: { '4': {}, '5': {} } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.goto('/')
  await page.locator('.filter-btn').click()
  const chip = (v: string) => page.locator(`.filter-method-chip[data-method="${v}"]`)
  await expect(page.locator('.filter-method-chip')).toHaveText(['bolt11', 'bolt12', 'On-chain'])
  await expect(chip('bolt11')).toHaveText('bolt11')
  await expect(chip('onchain')).toHaveText('On-chain')
  await expect(chip('bolt12')).toHaveText('bolt12')
  await expect(page.locator('.filter-method-proto')).toHaveCount(0)
  await expect(page.getByTestId('filter-method-note')).toHaveCount(0)
  await chip('onchain').click()
  await page.locator('.filter-apply-btn').click()
  await expect(page).toHaveURL(/[?&]method=onchain(&|$)/)
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-tag', { hasText: 'Method:' })).toHaveText(/Method:\s*On-chain$/)
})

test('390px: method chips are bolt11, bolt12 and On-chain, with no protocol note', async ({ page }) => {
  const m = (method: string) => ({ method, unit: 'sat', min_amount: 1, max_amount: 1000 })
  const rows = MOCK_KNOWN_MINTS.map((x, i) => (i === 0
    ? { ...x, mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('onchain')], nutsLimits: { '4': {}, '5': {} } }
    : { ...x, mintMethods: [m('bolt11')], meltMethods: [m('bolt11')], nutsLimits: { '4': {}, '5': {} } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.filter-btn').click()
  const chip = (v: string) => page.locator(`.filter-method-chip[data-method="${v}"]`)
  await expect(page.locator('.filter-method-chip')).toHaveText(['bolt11', 'bolt12', 'On-chain'])
  await expect(chip('bolt11')).toHaveText('bolt11')
  await expect(chip('onchain')).toHaveText('On-chain')
  await expect(page.locator('.filter-method-proto')).toHaveCount(0)
  await expect(page.getByTestId('filter-method-note')).toHaveCount(0)
})
