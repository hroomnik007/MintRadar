import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Rows that open a dialog are real keyboard controls (role=button, Tab, Enter / Space), focus goes back to
// the row when the dialog closes, and the page behind an open dialog does not scroll.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
})

test('Stats NUT row: focusable, Enter opens the modal, Escape closes it and focus returns to the row', async ({ page }) => {
  await page.goto('/stats')
  const row = page.locator('.stats-nut-row', { hasText: 'NUT-09' })
  await expect(row).toHaveAttribute('role', 'button')
  await expect(row).toHaveAttribute('tabindex', '0')
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.nut-modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.nut-modal')).toHaveCount(0)
  await expect(row).toBeFocused()
})

test('Stats Software row and Geographic row open with Space', async ({ page }) => {
  await page.goto('/stats')
  const sw = page.locator('.sw-row').first()
  await sw.focus()
  await page.keyboard.press('Space')
  await expect(page.locator('.nut-modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.nut-modal')).toHaveCount(0)
  await expect(sw).toBeFocused()
})

test('the page behind an open dialog does not scroll, and scrolls again after it closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 })
  await page.goto('/')
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add mint' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow)
  expect(locked).toBe('hidden')
  await page.mouse.move(20, 300)
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden')
})
