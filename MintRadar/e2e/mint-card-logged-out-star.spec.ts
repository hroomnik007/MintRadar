import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.describe('MintCard — watch star while logged out', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/?status=all')
    await expect(page.locator('.mint-grid .mint-card')).toHaveCount(4)
  })

  test('outline star is visible and opens the login prompt', async ({ page }) => {
    const star = page.locator('.mint-grid .mint-card', { hasText: 'Alpha Mint' }).locator('.card-star')
    await expect(star).toBeVisible()
    await expect(star).toHaveAttribute('aria-label', 'Watch')
    await expect(star).toHaveAttribute('aria-pressed', 'false')
    await expect(star).not.toHaveClass(/ on/)

    await star.click()
    const dialog = page.getByRole('dialog', { name: 'Watch this mint' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Login via Nostr' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })
})
