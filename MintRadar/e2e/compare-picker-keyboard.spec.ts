import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The "Compare with..." picker is usable with the keyboard alone (2026-10-27): its items are real
// <button role="option"> elements in a multi-select listbox with ONE Tab stop, arrow keys move, Enter/Space
// toggle, the focused item has a visible focus ring — and every candidate is listed (it used to stop at 50).
const EXTRA = Array.from({ length: 60 }, (_, i) => ({
  ...MOCK_KNOWN_MINTS[0],
  url: `https://m${String(i).padStart(2, '0')}.mint.example`,
  name: `Extra ${String(i).padStart(2, '0')} Mint`,
  reliabilityScore: 60,
}))

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp })

    test.beforeEach(async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, ...EXTRA] }))
      await page.goto('/')
      await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
      await expect(page.getByText('Compare with...')).toBeVisible()
    })

    test('lists every candidate without searching (no 50 cap)', async ({ page }) => {
      const options = page.getByRole('listbox', { name: 'Mints to compare' }).getByRole('option')
      // Bravo + Delta (online fixtures) + 60 extra online mints; Alpha is the base, Charlie is offline.
      await expect(options).toHaveCount(62)
      await options.last().scrollIntoViewIfNeeded()
      await expect(options.last()).toBeVisible()
    })

    test('Tab, arrow keys and Enter/Space pick mints; focus ring is visible', async ({ page }) => {
      await expect(page.locator('.md-picker-search')).toBeFocused()
      await page.keyboard.press('Tab')
      const options = page.getByRole('option')
      await expect(options.nth(0)).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(options.nth(1)).toBeFocused()
      const outline = await options.nth(1).evaluate(el => {
        const s = getComputedStyle(el)
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
      })
      expect(outline.style).toBe('solid')
      expect(outline.width).toBeGreaterThanOrEqual(2)
      await page.keyboard.press('Enter')
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('End')
      await expect(options.last()).toBeFocused()
      await page.keyboard.press(' ')
      await expect(options.last()).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Home')
      await expect(options.nth(0)).toBeFocused()
      await expect(page.locator('.md-picker-count')).toHaveText('2 of 3 selected')
      // One Tab stop: the next Tab leaves the list for the Compare button.
      await page.keyboard.press('Tab')
      await expect(page.locator('.md-picker-confirm')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByText('Mint Comparison')).toBeVisible()
    })

    test('ArrowDown from the search field enters the filtered list', async ({ page }) => {
      await page.locator('.md-picker-search').fill('Extra 59')
      await page.keyboard.press('ArrowDown')
      const only = page.getByRole('option', { name: /Extra 59 Mint/ })
      await expect(only).toBeFocused()
      await page.keyboard.press('Space')
      await expect(only).toHaveAttribute('aria-selected', 'true')
    })
  })
}
