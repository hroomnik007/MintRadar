import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

const SHOTS = process.env.FEE_SHOTS_DIR
// FEE_W (optional) only exists for taking screenshots at a given width.
if (process.env.FEE_W) test.use({ viewport: { width: Number(process.env.FEE_W), height: 900 } })

const [ALPHA, BRAVO] = MOCK_MINTS.map(m => m.url)
const keysets = (fee?: number) => [
  { id: '00aa000000000001', unit: 'sat', active: false, input_fee_ppk: 999 },
  { id: '00aa000000000002', unit: 'sat', active: true, ...(fee !== undefined ? { input_fee_ppk: fee } : {}) },
]

async function openCompare(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mint/probe**', route => {
    const target = new URL(route.request().url()).searchParams.get('url')
    const fee = target === ALPHA ? 100 : target === BRAVO ? 0 : undefined // Delta: not reported
    route.fulfill({ json: { url: target, online: true, latencyMs: 50, checkedAt: new Date().toISOString(), info: { name: 'Mint', nuts: {} }, keysets: keysets(fee) } })
  })
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Bravo Mint' }).click()
  await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}
const shot = async (page: Page) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/compare-fee-${page.viewportSize()!.width}.png`, fullPage: true })
}

test.describe('Compare: Input fee row', () => {
  test('desktop: different fees, free, and n/a for an unknown fee; inactive keyset ignored', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) <= 768, 'desktop grid only')
    await openCompare(page)
    const grid = page.locator('.cmp-grid')
    await expect(grid.locator('.cmp-lbl', { hasText: 'Input fee' })).toBeVisible()
    const cells = grid.locator('.cmp-input-fee')
    await expect(cells).toHaveCount(3)
    await expect(cells.nth(0)).toContainText('100 ppk')
    await expect(cells.nth(0)).toContainText('sat')
    await expect(cells.nth(1)).toContainText('free')
    await expect(cells.nth(2)).toHaveText('n/a')
    await expect(grid).not.toContainText('999')
    // Placed right after Latency, before NUT Count.
    const labels = await grid.locator('.cmp-lbl').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
    const i = labels.findIndex(l => l.startsWith('Input fee'))
    expect(labels[i - 1]).toBe('Latency')
    expect(labels[i + 1]).toBe('NUT Count')
    await shot(page)
  })

  test('mobile: the row shows for the selected mint tab', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) > 768, 'mobile stack only')
    await openCompare(page)
    const val = () => page.locator('.cmp-mobile-row', { hasText: 'Input fee' }).locator('.cmp-input-fee')
    await expect(val()).toContainText('100 ppk')
    await page.locator('.cmp-mobile-tabs button').nth(1).click()
    await expect(val()).toContainText('free')
    await page.locator('.cmp-mobile-tabs button').nth(2).click()
    await expect(val()).toHaveText('n/a')
    await shot(page)
  })
})
