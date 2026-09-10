import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

const card = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.mint-card', { hasText: name })

test.describe('MintCard — watch star + bottom row', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
  })

  test('the header star toggles the watchlist (no +Watch / ×Unwatch text buttons)', async ({ page }) => {
    // No text buttons anywhere on the Dashboard cards.
    await expect(page.getByRole('button', { name: '+ Watch' })).toHaveCount(0)
    await expect(page.locator('.mint-card').getByText('Unwatch', { exact: true })).toHaveCount(0)
    await expect(page.locator('.mint-card .watch-btn')).toHaveCount(0)

    const star = card(page, 'Alpha Mint').locator('.card-star')
    await expect(star).toHaveAttribute('aria-label', 'Watch')
    await expect(star).toHaveAttribute('aria-pressed', 'false')

    await star.click()
    await expect(star).toHaveAttribute('aria-label', 'Unwatch')
    await expect(star).toHaveAttribute('aria-pressed', 'true')

    // Reflected on the Watchlist.
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(1)
    await expect(page.locator('.wl-grid .mint-card', { hasText: 'Alpha Mint' })).toBeVisible()

    // Toggle back off from the Watchlist card's own star.
    await page.locator('.wl-grid .mint-card .card-star').click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(0)
  })

  test('a button in .card-bottom-main never overlaps the Trust figure', async ({ page }) => {
    const overlaps = await page.evaluate(() => {
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return [...document.querySelectorAll('.mint-grid .mint-card')].map(cardEl => {
        const fig = (cardEl.querySelector('.card-trust-score') ??
          cardEl.querySelector('.card-trust-na')) as HTMLElement
        const fr = fig.getBoundingClientRect()
        return [...cardEl.querySelectorAll('.card-bottom-main button')]
          .some(b => hit(b.getBoundingClientRect(), fr))
      })
    })
    expect(overlaps.every(o => o === false), JSON.stringify(overlaps)).toBe(true)
  })
})
