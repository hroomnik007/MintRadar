// Dashboard payment-method filter (?method=, utils/methodFilter.ts): options come from what mints offer,
// NUT-04 or NUT-05 on any unit counts, a switched-off side (#168) does not; counted in the Filters badge.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const base = MOCK_KNOWN_MINTS[0]
const mk = (name: string, reliabilityScore: number, over: Record<string, unknown>) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true, degraded: false, archived: false, units: ['sat'], reliabilityScore,
  nutsLimits: { '4': {}, '5': {} },
  ...over,
})
const m = (method: string, unit = 'sat') => ({ method, unit, min_amount: 1, max_amount: 1000 })
const mints = [
  mk('Alpha', 92, { mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('bolt11')] }),
  mk('Bravo', 55, { mintMethods: [m('bolt11')], meltMethods: [m('onchain', 'usd')] }),
  // Deposits switched off: its bolt12 entry must not count.
  mk('Delta', 78, { mintMethods: [m('bolt12')], meltMethods: [m('bolt11')], nutsLimits: { '4': { methods: [], disabled: true }, '5': {} } }),
  mk('India', 66, { mintMethods: null, meltMethods: null }),
]

async function setup(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
}
const names = (page: Page) => page.locator('.mint-card .mint-name').allTextContents()
const cards = (page: Page) => page.locator('.mint-card')
const chip = (page: Page, v: string) => page.locator(`.filter-method-chip[data-method="${v}"]`)

test.describe('Dashboard method filter', () => {
  test('?method=bolt12 keeps mints that offer it; a switched-off deposit side does not count; badge counts it', async ({ page }) => {
    await setup(page)
    await page.goto('/?method=bolt12')
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page).first()).toContainText('Alpha Mint')
    await expect(page.locator('.filter-btn')).toContainText('1')
  })

  test('withdrawal-only method on another unit matches (NUT-05, any unit)', async ({ page }) => {
    await setup(page)
    await page.goto('/?method=onchain')
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page).first()).toContainText('Bravo Mint')
  })

  test('options come from offered methods; picking one updates the URL; the tag clears it', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await expect(cards(page)).toHaveCount(4)
    await page.locator('.filter-btn').click()
    await expect(page.locator('.filter-method-chip')).toHaveText(['bolt11', 'bolt12', 'onchain'])
    await chip(page, 'bolt11').click()
    await expect(chip(page, 'bolt11')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.filter-apply-btn')).toHaveText('Show 3 of 4')
    await page.locator('.filter-apply-btn').click()
    await expect(page).toHaveURL(/[?&]method=bolt11(&|$)/)
    await expect(cards(page)).toHaveCount(3)
    expect(await names(page)).not.toContain('India Mint')
    await page.locator('.filter-btn').click()
    await page.getByRole('button', { name: 'Clear method filter' }).click()
    await expect(page).not.toHaveURL(/method=/)
    await expect(cards(page)).toHaveCount(4)
  })

  test('a malformed ?method= is ignored', async ({ page }) => {
    await setup(page)
    await page.goto('/?method=bolt%2011')
    await expect(cards(page)).toHaveCount(4)
  })
})
