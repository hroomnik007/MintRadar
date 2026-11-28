import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { cmpRowIds, cmpValues } from './fixtures/compare'

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
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
}
const shot = async (page: Page) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/compare-fee-${page.viewportSize()!.width}.png`, fullPage: true })
}

// One layout on every width since the Compare redesign (2026-11-28): the row sits in "Deposits and withdrawals" after the
// payment-method rows, says "free" for 0 and the rate per coin otherwise, and the single lowest fee gets BEST
// (none here: Delta's fee is unknown, and a missing value means no tag in that row, utils/compareBest.ts).
test.describe('Compare: Input fee row', () => {
  test('different fees, free, and n/a for an unknown fee; inactive keyset ignored', async ({ page }) => {
    await openCompare(page)
    await expect(page.locator('.cmp-input-fee')).toHaveCount(2)
    await expect.poll(() => cmpValues(page, 'fee')).toEqual(['0.1 sat per coin', 'free', 'n/a'])
    expect((await cmpValues(page, 'fee')).join(' ')).not.toContain('999')
    const ids = await cmpRowIds(page)
    expect(ids[ids.indexOf('fee') + 1]).toBe('units')
    expect(ids[ids.indexOf('fee') - 1]).toMatch(/^method-/)
    await shot(page)
  })
})
