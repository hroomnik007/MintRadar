import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const m = (method: string) => ({ method, unit: 'sat', min_amount: 1, max_amount: 1000 })
const nuts = (...keys: string[]) => Object.fromEntries(keys.map(k => [k, { methods: [] }]))

// mA: bolt11+bolt12 both sides, NUT-09        -> restore ✓ bolt12 ✓ ln ✓
// mB: bolt11 both sides, no NUT-09            -> restore ✗ bolt12 ✗ ln ✓
// mC: bolt11 mint only (no melt), NUT-09      -> restore ✓ bolt12 ✗ ln ✗ (LN in)
// mD: bolt12 both sides, NUT-09               -> restore ✓ bolt12 ✓ ln ✓
const KNOWN = [
  { ...MOCK_KNOWN_MINTS[0], url: 'https://ma.example', name: 'Mint A', online: true, degraded: false, trustScore: 90,
    mintMethods: [m('bolt11'), m('bolt12')], meltMethods: [m('bolt11'), m('bolt12')], nutsLimits: nuts('4', '5', '9') },
  { ...MOCK_KNOWN_MINTS[0], url: 'https://mb.example', name: 'Mint B', online: true, degraded: false, trustScore: 80,
    mintMethods: [m('bolt11')], meltMethods: [m('bolt11')], nutsLimits: nuts('4', '5') },
  { ...MOCK_KNOWN_MINTS[0], url: 'https://mc.example', name: 'Mint C', online: true, degraded: false, trustScore: 70,
    mintMethods: [m('bolt11')], meltMethods: null, nutsLimits: nuts('4', '5', '9') },
  { ...MOCK_KNOWN_MINTS[0], url: 'https://md.example', name: 'Mint D', online: true, degraded: false, trustScore: 60,
    mintMethods: [m('bolt12')], meltMethods: [m('bolt12')], nutsLimits: nuts('4', '5', '9') },
]

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
})

const names = (page: import('@playwright/test').Page) => page.locator('.mint-grid .card-name')

test.describe('Dashboard capability filters (Restore / Bolt12 / LN)', () => {
  test('default load sets none of the three flags and shows every mint', async ({ page }) => {
    await page.goto('/')
    await expect(names(page)).toHaveText(['Mint A', 'Mint B', 'Mint C', 'Mint D'])
    expect(new URL(page.url()).search).toBe('')
  })

  test('Restore keeps only mints listing NUT-09', async ({ page }) => {
    await page.goto('/?restore=1')
    await expect(names(page)).toHaveText(['Mint A', 'Mint C', 'Mint D'])
    await expect(page.locator('.filter-active-tags')).toHaveCount(0) // panel closed
  })

  test('Bolt12 keeps only mints with a bolt12 method on either side', async ({ page }) => {
    await page.goto('/?bolt12=1')
    await expect(names(page)).toHaveText(['Mint A', 'Mint D'])
  })

  test('LN keeps only mints with Lightning on BOTH mint and melt', async ({ page }) => {
    await page.goto('/?ln=1')
    // Mint C is "LN in" only -> excluded
    await expect(names(page)).toHaveText(['Mint A', 'Mint B', 'Mint D'])
  })

  test('combines with ?nut=09', async ({ page }) => {
    await page.goto('/?ln=1&nut=09')
    // ln: A,B,D  ∩  NUT-09: A,C,D  =  A,D
    await expect(names(page)).toHaveText(['Mint A', 'Mint D'])
  })

  test('checkbox toggles the flag, URL param and active-tag; clearing the tag turns it off', async ({ page }) => {
    await page.goto('/')
    await page.locator('.filter-btn').click()
    await page.getByLabel('Bolt12').check()
    await page.getByRole('button', { name: 'Apply filter' }).click()

    await expect(page).toHaveURL(/[?&]bolt12=1/)
    await expect(names(page)).toHaveText(['Mint A', 'Mint D'])

    // The active-tag lives in the (now closed) Filters panel — same pattern as
    // "Hide test mints". Reopen to see and clear it.
    await page.locator('.filter-btn').click()
    await expect(page.locator('.filter-active-tags .filter-tag', { hasText: 'Bolt12' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear Bolt12 filter' }).click()

    expect(new URL(page.url()).searchParams.get('bolt12')).toBeNull()
    await expect(names(page)).toHaveText(['Mint A', 'Mint B', 'Mint C', 'Mint D'])
  })

  test('search still bypasses hide-test / online default (capability filters are AND, unchanged)', async ({ page }) => {
    // A test-mint URL, offline, but matching the search query -> still shown,
    // exactly as before this change.
    await page.route('**/api/mints/known', r => r.fulfill({ json: [
      ...KNOWN,
      { ...MOCK_KNOWN_MINTS[0], url: 'https://testnut.cashu.space', name: 'Cashu test mint', online: false, degraded: false, nutsLimits: nuts('4', '5') },
    ] }))
    await page.goto('/')
    await page.getByPlaceholder(/Search mints/).fill('cashu test')
    await expect(names(page)).toHaveText(['Cashu test mint'])
  })
})
