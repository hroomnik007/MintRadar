import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Mock review rollup (see e2e/fixtures/mocks.ts):
//   Alpha   → 12 reviews @ 4.2   Bravo   → 0 reviews ("No reviews yet")
//   Charlie → 4 reviews @ 3.0    Delta   → 3 reviews @ 4.8
// Charlie is offline: it has no Reliability Score badge but still shows a
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

    // The rating badge is 3 adjacent spans (★ / value / (count)) with no
    // whitespace between them in JSX, so the rendered textContent has no
    // space before the parenthesized count — e.g. "4.2(12)", not "4.2 (12)".
    await expect(card(page, 'Alpha Mint').locator('.card-reliability-rating', { hasText: '4.2(12)' })).toBeVisible()
    await expect(card(page, 'Delta Mint').locator('.card-reliability-rating', { hasText: '4.8(3)' })).toBeVisible()
    // Offline mint — Reliability Score number absent ("Reliability n/a"), Community Rating still shown.
    await expect(card(page, 'Charlie Mint').locator('.card-reliability-rating', { hasText: '3.0(4)' })).toBeVisible()
    // 0 reviews → no rating pill, but a muted "No reviews yet" note instead.
    await expect(card(page, 'Bravo Mint').locator('.card-reliability-rating')).toHaveCount(0)
    await expect(card(page, 'Bravo Mint').locator('.card-reliability-no-reviews')).toHaveText('No reviews yet')
  })

  test('Reliability block uses a shield icon, not a star, and no %', async ({ page }) => {
    await page.goto('/?status=all')
    const alpha = card(page, 'Alpha Mint')
    const reliability = alpha.locator('.card-reliability')
    await expect(reliability).toBeVisible()
    // The RELIABILITY label sits in its own top row (above LATENCY), not
    // nested inside `.card-reliability` — see "card-reliability-toprow" in
    // MintCard.tsx/Dashboard.css.
    await expect(alpha.locator('.card-reliability-label svg')).toHaveCount(1)
    await expect(alpha.locator('.card-reliability-label')).not.toContainText('★')
    await expect(reliability.locator('.card-reliability-score')).toHaveText('92')
  })

  test('badge is shared with the Watchlist card', async ({ page }) => {
    await loginAs(page)
    await page.goto('/?status=all')
    await card(page, 'Alpha Mint').getByRole('button', { name: 'Watch', exact: true }).click()
    await page.getByRole('link', { name: 'Watchlist' }).click()

    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(1)
    await expect(
      page.locator('.wl-grid .mint-card').locator('.card-reliability-rating', { hasText: '4.2(12)' })
    ).toBeVisible()
  })
})
