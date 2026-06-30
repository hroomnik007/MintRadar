import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  // Wait for the mocked mint list to render.
  await expect(page.locator('.mint-card')).toHaveCount(4)
})

test.describe('Dashboard', () => {
  test('loads and lists the known mints', async ({ page }) => {
    await expect(page.locator('.card-name', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Delta Mint' })).toBeVisible()
    // Stat bar reflects the mocked data: 3 of 4 mints online.
    await expect(page.locator('.stat-value.green')).toHaveText('3 / 4')
  })

  test('search filters the mint list', async ({ page }) => {
    const search = page.getByPlaceholder(/Search mints/)
    await search.fill('alpha')

    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(page.locator('.card-name', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Bravo Mint' })).toHaveCount(0)

    // Clearing the query restores the full list.
    await search.fill('')
    await expect(page.locator('.mint-card')).toHaveCount(4)
  })

  test('filter panel opens and closes', async ({ page }) => {
    const filterBtn = page.getByRole('button', { name: 'Filters', exact: true })
    await expect(page.locator('.filter-panel')).toHaveCount(0)

    await filterBtn.click()
    await expect(page.locator('.filter-panel')).toBeVisible()

    await filterBtn.click()
    await expect(page.locator('.filter-panel')).toHaveCount(0)
  })

  test('sorting reorders the mints', async ({ page }) => {
    const names = page.locator('.mint-grid .card-name')
    // The active sort button appends an arrow (e.g. "Name ↑"), so target by class + substring.
    const sortBtn = (label: string) => page.locator('.sort-btn', { hasText: label })

    // Default sort is Name ascending.
    await expect(names).toHaveText(['Alpha Mint', 'Bravo Mint', 'Charlie Mint', 'Delta Mint'])

    // Trust Score (desc): Alpha 92, Delta 78, Bravo 55, Charlie offline → 0.
    await sortBtn('Trust Score').click()
    await expect(names).toHaveText(['Alpha Mint', 'Delta Mint', 'Bravo Mint', 'Charlie Mint'])

    // Switching to Name resets to ascending; clicking it again toggles to descending.
    await sortBtn('Name').click()
    await expect(names).toHaveText(['Alpha Mint', 'Bravo Mint', 'Charlie Mint', 'Delta Mint'])
    await sortBtn('Name').click()
    await expect(names).toHaveText(['Delta Mint', 'Charlie Mint', 'Bravo Mint', 'Alpha Mint'])
  })

  test('clicking a mint card opens its detail page', async ({ page }) => {
    await page.locator('.card-name', { hasText: 'Alpha Mint' }).click()

    await expect(page).toHaveURL(/\/mint\/https%3A%2F%2Falpha\.mint\.example/)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
  })
})
