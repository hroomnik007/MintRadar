import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Mock review rollup (see e2e/fixtures/mocks.ts):
//   Alpha   → 12 reviews @ 4.2   Bravo   → 0 reviews (no badge)
//   Charlie → 4 reviews @ 3.0    Delta   → 3 reviews @ 4.8
// Charlie is offline: it has no Trust Score badge but still shows a
// Community Rating badge.

test.describe('MintCard — Community Rating badge', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
  })

  const card = (page: import('@playwright/test').Page, name: string) =>
    page.locator('.mint-card', { hasText: name })

  test('Community Rating badge shows only when the mint has reviews', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await expect(card(page, 'Alpha Mint').locator('.card-trust-rating', { hasText: '4.2 (12)' })).toBeVisible()
    await expect(card(page, 'Delta Mint').locator('.card-trust-rating', { hasText: '4.8 (3)' })).toBeVisible()
    // Offline mint — Trust Score number absent ("Trust n/a"), Community Rating still shown.
    await expect(card(page, 'Charlie Mint').locator('.card-trust-rating', { hasText: '3.0 (4)' })).toBeVisible()
    // 0 reviews → no rating at all.
    await expect(card(page, 'Bravo Mint').locator('.card-trust-rating')).toHaveCount(0)
  })

  test('Trust block uses a shield icon, not a star, and no %', async ({ page }) => {
    await page.goto('/?status=all')
    const trust = card(page, 'Alpha Mint').locator('.card-trust')
    await expect(trust).toBeVisible()
    await expect(trust.locator('.card-trust-label svg')).toHaveCount(1)
    await expect(trust.locator('.card-trust-label')).not.toContainText('★')
    await expect(trust.locator('.card-trust-score')).toHaveText('92')
  })

  test('badge is shared with the Watchlist card', async ({ page }) => {
    await loginAs(page)
    await page.goto('/?status=all')
    await card(page, 'Alpha Mint').getByRole('button', { name: 'Watch', exact: true }).click()
    await page.getByRole('link', { name: 'Watchlist' }).click()

    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(1)
    await expect(
      page.locator('.wl-grid .mint-card').locator('.card-trust-rating', { hasText: '4.2 (12)' })
    ).toBeVisible()
  })
})
