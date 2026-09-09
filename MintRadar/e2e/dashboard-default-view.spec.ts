import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// New Dashboard default (2026-09-09): online-only, test mints hidden,
// sorted by Trust Score desc with a displayName asc tie-break.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Dashboard default view', () => {
  test('fresh load: no offline / test-mint cards, ordered by Trust desc then displayName', async ({ page }) => {
    // Two extra online mints on the same Trust Score to exercise the tie-break,
    // plus a known test mint that must stay hidden by default.
    const tieHi = { ...MOCK_KNOWN_MINTS[0], url: 'https://zulu.mint.example', name: 'Zulu Mint', online: true, degraded: false, trustScore: 70 }
    const tieLo = { ...MOCK_KNOWN_MINTS[0], url: 'https://kilo.mint.example', name: 'Kilo Mint', online: true, degraded: false, trustScore: 70 }
    const testMint = { ...MOCK_KNOWN_MINTS[0], url: 'https://testnut.cashu.space', name: 'Cashu test mint', online: true, degraded: false, trustScore: 99 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, tieHi, tieLo, testMint] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    // test mint hidden despite its top Trust Score; offline Charlie hidden too
    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toHaveCount(0)
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toHaveCount(0)

    // Trust desc: Alpha 92, Delta 78, then the 70-tie (Kilo before Zulu by name), Bravo 55
    await expect(page.locator('.mint-grid .card-name')).toHaveText([
      'Alpha Mint', 'Delta Mint', 'Kilo Mint', 'Zulu Mint', 'Bravo Mint',
    ])
  })

  test('turning "Hide test mints" off brings the test mint back into the grid', async ({ page }) => {
    const testMint = { ...MOCK_KNOWN_MINTS[0], url: 'https://testnut.cashu.space', name: 'Cashu test mint', online: true, degraded: false, trustScore: 50 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, testMint] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Hide test mints').uncheck()
    await page.getByRole('button', { name: 'Apply filter' }).click()

    await expect(page.locator('.card-name', { hasText: 'Cashu test mint' })).toBeVisible()
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
    const degraded = { ...MOCK_KNOWN_MINTS[0], url: 'https://golf.mint.example', name: 'Golf Mint', online: false, degraded: true, trustScore: 20 }
    await page.route('**/api/mints/known', r =>
      r.fulfill({ json: [...MOCK_KNOWN_MINTS, degraded] }))

    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    // hidden by default, offline Charlie stays hidden too
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
