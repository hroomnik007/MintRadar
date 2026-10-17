import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// The Rules of /about point to the stability section of the wallet page.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('the Rules link to /for-wallets#stability opens the Stability section', async ({ page }) => {
  await page.goto('/about')
  const rules = page.locator('section[aria-labelledby="terms"]')
  await rules.getByRole('link', { name: 'For wallets' }).click()
  await expect(page).toHaveURL(/\/for-wallets#stability$/)
  const heading = page.getByRole('heading', { name: 'Stability', level: 2 })
  await expect(heading).toBeVisible()
  await expect(heading).toBeInViewport()
})
