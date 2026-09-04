import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// The Wallets page is a plain list rendered from src/constants/wallets.ts.
// eNuts was removed (enuts.cash was down, so the card linked nowhere).
test('Wallets page lists 9 wallets and no longer includes eNuts', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/wallets')
  await page.waitForSelector('.wallet-card')

  await expect(page.locator('.wallet-card')).toHaveCount(9)
  await expect(page.getByText('eNuts', { exact: true })).toHaveCount(0)
  // A couple of the recently-added / renamed entries are still present.
  await expect(page.locator('.wallet-card', { hasText: 'Macadamia' })).toHaveCount(1)
  await expect(page.locator('.wallet-card', { hasText: 'Agicash' })).toHaveCount(1)
})
