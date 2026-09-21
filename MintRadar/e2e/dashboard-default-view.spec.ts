import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Dashboard default view', () => {
  test('fresh load: no offline cards, test mint shown, ordered by Reliability desc', async ({ page }) => {
    const tieHi = { ...MOCK_KNOWN_MINTS[0], url: 'https://zulu.mint.example', name: 'Zulu Mint', online: true, degraded: false, reliabilityScore: 70, reviewCount: 20, reviewAvgRating: 4.9, reviewWeightedRating: 4.6 }
    const tieLo = { ...MOCK_KNOWN_MINTS[0], url: 'https://kilo.mint.example', name: 'Kilo Mint', online: true, degraded: false, reliabilityScore: 70, reviewCount: 4, reviewAvgRating: 3.1, reviewWeightedRating: 3.2 }
    const testMint = { ...MOCK_KNOWN_MINTS[0], url: 'https://testnut.cashu.space', name: 'Cashu test mint', online: true, degraded: false, reliabilityScore: 99 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, tieHi, tieLo, testMint] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toHaveCount(0)

    // Reliability desc; equal Reliability (70) currently still name-asc (Kilo then Zulu)
    // until Dashboard imports compareReliabilityThenRating from reliabilitySort.ts.
    await expect(page.locator('.mint-grid .card-name')).toHaveText([
      'Cashu test mint', 'Alpha Mint', 'Delta Mint', 'Zulu Mint', 'Kilo Mint', 'Bravo Mint',
    ])
  })

  test('checking "Hide test mints" removes the test mint from the grid', async ({ page }) => {
    const testMint = { ...MOCK_KNOWN_MINTS[0], url: 'https://testnut.cashu.space', name: 'Cashu test mint', online: true, degraded: false, reliabilityScore: 50 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, testMint] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toBeVisible()

    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Hide test mints').check()
    await page.getByRole('button', { name: 'Apply filter' }).click()

    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]testmints=hide/)
  })

  test('Name chip sorts the visible (online) mints by displayName', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.locator('.sort-btn', { hasText: 'Name' }).click()
    await expect(page.locator('.mint-grid .card-name')).toHaveText([
      'Alpha Mint', 'Bravo Mint', 'Delta Mint',
    ])
  })

  test('24h+ "Show" path still reveals only the degraded mint', async ({ page }) => {
    const degraded = { ...MOCK_KNOWN_MINTS[0], url: 'https://golf.mint.example', name: 'Golf Mint', online: false, degraded: true, reliabilityScore: 20 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, degraded] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await expect(page.locator('.card-name', { hasText: 'Golf Mint' })).toHaveCount(0)
    const note = page.locator('.degraded-note')
    await expect(note).toContainText('1 mints hidden (offline 24h+)')

    await note.getByRole('button', { name: 'Show' }).click()
    await expect(page.locator('.card-name', { hasText: 'Golf Mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toHaveCount(0)
  })

  test('action strip deep links still reach /tools#pick and #token', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'Help me pick' }).click()
    await expect(page).toHaveURL(/\/tools#pick$/)
    await expect(page.locator('#pick').getByText('Best Mint for Me')).toBeInViewport()

    await page.goBack()
    await page.getByRole('button', { name: 'I have a token' }).click()
    await expect(page).toHaveURL(/\/tools#token$/)
    await expect(page.locator('#token').getByText('Token Inspector')).toBeInViewport()
  })
})
