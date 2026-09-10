import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Stats "NUT Coverage Across the Network": a NUT row click opens the mint-list
// modal (like the Software / Geographic modals) instead of navigating to the
// Dashboard ?nut filter. NUT-09 is supported by Alpha / Bravo / Delta in the
// fixture set (nutCount >= 5), not by the offline Charlie.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
})

const modal = (page: import('@playwright/test').Page) => page.locator('.nut-modal')

test.describe('Stats NUT coverage modal', () => {
  test('clicking a NUT row opens the mint-list modal, not a Dashboard nav', async ({ page }) => {
    await page.goto('/stats')
    await expect(page.locator('.stats-nut-row').first()).toBeVisible()

    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()

    // stays on /stats — no ?nut redirect
    await expect(page).toHaveURL(/\/stats$/)
    await expect(modal(page)).toBeVisible()
    await expect(modal(page).locator('.nut-modal-title')).toContainText('NUT-09')

    // supporting mints, sorted by Trust desc: Alpha 92, Delta 78, Bravo 55
    const rows = modal(page).locator('.nut-modal-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Alpha Mint')
    await expect(rows.nth(1)).toContainText('Delta Mint')
    await expect(rows.nth(2)).toContainText('Bravo Mint')
    await expect(modal(page).getByText('Charlie Mint')).toHaveCount(0)

    // footer online/offline + sort note
    await expect(modal(page).locator('.nut-modal-footer')).toContainText('3 online · 0 offline')
    await expect(modal(page).locator('.nut-modal-footer')).toContainText('Sorted by Trust Score')
  })

  test('no leftover age badges and no "Show on Dashboard" button in the modal', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page)).toBeVisible()

    for (const label of ['Established', 'Veteran', 'OG']) {
      await expect(modal(page).getByText(label, { exact: true })).toHaveCount(0)
    }
    await expect(modal(page).getByRole('button', { name: /Show on Dashboard/i })).toHaveCount(0)
  })

  test('a row name links through to that mint\'s detail page', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page)).toBeVisible()

    await modal(page).locator('.nut-modal-row-name', { hasText: 'Alpha Mint' }).click()

    await expect(page).toHaveURL(new RegExp(`/mint/${encodeURIComponent('https://alpha.mint.example')}$`))
    await expect(modal(page)).toHaveCount(0)
  })

  test('Escape / ✕ / overlay all close the modal', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-07' }).click()
    await expect(modal(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(modal(page)).toHaveCount(0)

    await page.locator('.stats-nut-row', { hasText: 'NUT-07' }).click()
    await modal(page).locator('.nut-modal-close').click()
    await expect(modal(page)).toHaveCount(0)
  })
})
