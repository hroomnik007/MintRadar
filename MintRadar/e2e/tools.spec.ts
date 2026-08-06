import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, MOCK_MINTS } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/tools')
  await expect(page.getByText('Token Inspector')).toBeVisible()
})

test.describe('Tools', () => {
  test('Token Inspector decodes a valid cashu token', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8]) // Alpha Mint, 29 sat total

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toBeVisible()
    await expect(grid).toContainText('Alpha Mint')   // resolved from known mints
    await expect(grid).toContainText('29')           // summed proof amounts
    await expect(grid).toContainText('Online')       // mint status from known mints
  })

  test('Token Inspector shows an error for an invalid token (no crash)', async ({ page }) => {
    await page.locator('.token-input').fill('this-is-not-a-cashu-token')
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    await expect(page.locator('.token-error')).toBeVisible()
    await expect(page.locator('.token-error')).toContainText(/Invalid token format/)
    // No result grid is rendered for an invalid token.
    await expect(page.locator('.token-result-grid')).toHaveCount(0)
  })

  test('Best Mint Wizard walks through 3 questions and recommends mints', async ({ page }) => {
    // Step 1 — how much to store (auto-advances to step 2).
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    // Step 2 — what matters most (auto-advances to step 3).
    await page.locator('.wizard-opt', { hasText: 'Speed' }).click()
    // Step 3 — backup/restore preference (does not auto-advance).
    await page.locator('.wizard-opt', { hasText: 'Not sure' }).click()

    await page.getByRole('button', { name: /Find my mints/ }).click()

    // Recommendations are computed from the mocked known mints.
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).not.toHaveCount(0)
  })
})
