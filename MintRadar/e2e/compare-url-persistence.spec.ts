import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Compare — URL persistence (?compare=)', () => {
  test('Dashboard: confirming a comparison writes ?compare= to the URL', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()

    await expect(page.getByText('Mint Comparison')).toBeVisible()
    await expect(page).toHaveURL(/compare=https%3A%2F%2Falpha\.mint\.example%2Chttps%3A%2F%2Fdelta\.mint\.example/)
  })

  test('Dashboard: reloading a copied ?compare= link reopens the same comparison', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()
    await expect(page.getByText('Mint Comparison')).toBeVisible()

    const shareableUrl = page.url()
    await page.reload()
    await expect(page).toHaveURL(shareableUrl)
    await expect(page.getByText('Mint Comparison')).toBeVisible()
    const modal = page.locator('.cmp-modal')
    await expect(modal.getByText('Alpha Mint')).toBeVisible()
    await expect(modal.getByText('Delta Mint')).toBeVisible()
  })

  test('Dashboard: closing the modal removes ?compare= from the URL', async ({ page }) => {
    await page.goto('/?status=all&compare=https%3A%2F%2Falpha.mint.example%2Chttps%3A%2F%2Fdelta.mint.example')
    await expect(page.getByText('Mint Comparison')).toBeVisible()

    await page.locator('.cmp-modal-header button').click()
    await expect(page.getByText('Mint Comparison')).not.toBeVisible()
    await expect(page).not.toHaveURL(/compare=/)
  })

  test('Dashboard: a fresh page load with ?compare= auto-opens the modal with the same mints preselected', async ({ page }) => {
    await page.goto('/?status=all&compare=https%3A%2F%2Falpha.mint.example%2Chttps%3A%2F%2Fbravo.mint.example')

    await expect(page.getByText('Mint Comparison')).toBeVisible()
    const modal = page.locator('.cmp-modal')
    await expect(modal.getByText('Alpha Mint')).toBeVisible()
    await expect(modal.getByText('Bravo Mint')).toBeVisible()
  })

  test('Dashboard: an untracked/invalid URL in ?compare= is skipped, not a crash', async ({ page }) => {
    await page.goto('/?status=all&compare=https%3A%2F%2Fnotreal.mint.example%2Chttps%3A%2F%2Falpha.mint.example%2Chttps%3A%2F%2Fdelta.mint.example')

    // The two valid mints still render the comparison; the app doesn't error out.
    await expect(page.getByText('Mint Comparison')).toBeVisible()
    const modal = page.locator('.cmp-modal')
    await expect(modal.getByText('Alpha Mint')).toBeVisible()
    await expect(modal.getByText('Delta Mint')).toBeVisible()
    await expect(page.locator('.mint-grid')).toBeAttached()
  })

  test('Dashboard: ?compare= with only one resolvable mint does not open the modal', async ({ page }) => {
    await page.goto('/?status=all&compare=https%3A%2F%2Fnotreal.mint.example%2Chttps%3A%2F%2Falpha.mint.example')

    await expect(page.getByText('Mint Comparison')).not.toBeVisible()
    await expect(page.locator('.mint-card')).toHaveCount(4)
  })

  test('Watchlist: Compare is available on watched mints and persists to the URL', async ({ page }) => {
    await loginAs(page)
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    for (const name of ['Alpha Mint', 'Delta Mint']) {
      const card = page.locator('.mint-card', { has: page.locator('.card-name', { hasText: name }) })
      await card.getByRole('button', { name: 'Watch', exact: true }).click()
    }

    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page).toHaveURL(/\/watchlist$/)
    await expect(page.locator('.wl-grid .card-name', { hasText: 'Alpha Mint' })).toBeVisible()

    await page.locator('.wl-grid .mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()

    await expect(page.getByText('Mint Comparison')).toBeVisible()
    await expect(page).toHaveURL(/compare=https%3A%2F%2Falpha\.mint\.example%2Chttps%3A%2F%2Fdelta\.mint\.example/)

    await page.locator('.cmp-modal-header button').click()
    await expect(page).not.toHaveURL(/compare=/)
  })
})
