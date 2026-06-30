import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Primary navigation', () => {
  test('navigates between all top-level tabs', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()

    // Dashboard (home)
    await expect(page).toHaveURL('http://localhost:5173/')
    await expect(page.getByPlaceholder(/Search mints/)).toBeVisible()

    // Watchlist
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page).toHaveURL(/\/watchlist$/)
    await expect(page.getByRole('heading', { name: 'My Watchlist' })).toBeVisible()

    // Stats
    await page.getByRole('link', { name: 'Stats' }).click()
    await expect(page).toHaveURL(/\/stats$/)
    await expect(page.getByText('Mints Tracked')).toBeVisible()

    // Tools
    await page.getByRole('link', { name: 'Tools' }).click()
    await expect(page).toHaveURL(/\/tools$/)
    await expect(page.getByText('Token Inspector')).toBeVisible()

    // Back to Dashboard
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL('http://localhost:5173/')
  })

  test('mobile viewport (375px) keeps navigation working', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    // Tabs wrap to a full-width row on mobile but remain visible and clickable.
    await expect(page.getByRole('link', { name: 'Tools' })).toBeVisible()
    await page.getByRole('link', { name: 'Tools' }).click()
    await expect(page).toHaveURL(/\/tools$/)
    await expect(page.getByText('Token Inspector')).toBeVisible()

    await page.getByRole('link', { name: 'Stats' }).click()
    await expect(page).toHaveURL(/\/stats$/)
    await expect(page.getByText('Mints Tracked')).toBeVisible()
  })
})
