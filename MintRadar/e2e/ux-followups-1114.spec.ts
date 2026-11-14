import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// UI/UX follow-ups of 2026-11-14: the phone list view shows the rating like the cards do, and the method filter names
// Lightning and On-chain without hiding the protocol (the value stays bolt11 / onchain).

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

test('method filter: "Lightning" = bolt11 and "On-chain" = onchain, the protocol name stays visible', async ({ page }) => {
  const m = (method: string) => ({ method, unit: 'sat', min_amount: 1, max_amount: 1000 })
  const rows = MOCK_KNOWN_MINTS.map((x, i) => (i === 0
    ? { ...x, mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('onchain')], nutsLimits: { '4': {}, '5': {} } }
    : { ...x, mintMethods: [m('bolt11')], meltMethods: [m('bolt11')], nutsLimits: { '4': {}, '5': {} } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.goto('/')
  await page.locator('.filter-btn').click()
  const chip = (v: string) => page.locator(`.filter-method-chip[data-method="${v}"]`)
  await expect(chip('bolt11')).toHaveText('Lightning bolt11')
  await expect(chip('onchain')).toHaveText('On-chain')
  await expect(chip('bolt12')).toHaveText('bolt12')
  await expect(chip('bolt11').locator('.filter-method-proto')).toBeVisible()
  // Wide screens name the protocol in the chip, so the note under the group (for phones) is not shown.
  await expect(page.getByTestId('filter-method-note')).toBeHidden()
  await chip('onchain').click()
  await page.locator('.filter-apply-btn').click()
  await expect(page).toHaveURL(/[?&]method=onchain(&|$)/)
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-tag', { hasText: 'Method:' })).toContainText('Method: On-chain (onchain)')
})

test('390px: the method chips keep the plain names and the note below names the protocols', async ({ page }) => {
  const m = (method: string) => ({ method, unit: 'sat', min_amount: 1, max_amount: 1000 })
  const rows = MOCK_KNOWN_MINTS.map((x, i) => (i === 0
    ? { ...x, mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('onchain')], nutsLimits: { '4': {}, '5': {} } }
    : { ...x, mintMethods: [m('bolt11')], meltMethods: [m('bolt11')], nutsLimits: { '4': {}, '5': {} } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.filter-btn').click()
  const chip = (v: string) => page.locator(`.filter-method-chip[data-method="${v}"]`)
  await expect(chip('bolt11').locator('.filter-method-proto')).toBeHidden()
  await expect(page.getByTestId('filter-method-note')).toBeVisible()
  await expect(page.getByTestId('filter-method-note')).toHaveText('Lightning = bolt11 · On-chain = onchain')
  const px = await page.getByTestId('filter-method-note').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(px).toBeGreaterThanOrEqual(12)
})
