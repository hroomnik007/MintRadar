import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, makeCashuTokenV4, MOCK_MINTS } from './fixtures/mocks'

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

  test('Token Inspector decodes a v4 (cashuB) token', async ({ page }) => {
    const token = makeCashuTokenV4(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toBeVisible()
    await expect(grid).toContainText('Alpha Mint')
    await expect(grid).toContainText('29')
    await expect(page.locator('.token-details-row')).toContainText('v4 (cashuB)')
  })

  test('Token Inspector offers verified wallet + redeem deep links', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    const wallet = page.getByRole('link', { name: /Open in wallet/ })
    await expect(wallet).toHaveAttribute('href', new RegExp(`^https://wallet\\.cashu\\.me/\\?token=${token}$`))
    const redeem = page.getByRole('link', { name: /Redeem to Lightning/ })
    await expect(redeem).toHaveAttribute('href', new RegExp(`^https://redeem\\.cashu\\.me/\\?token=${token}$`))
  })

  test('Token Inspector renders a fiat amount in its minor unit, not as whole currency', async ({ page }) => {
    // NUT-01: a usd token carrying 20 is 20 cents, so this must read $0.20 and never $20.
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [15, 5], 'usd')

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toContainText('$0.20')
    await expect(grid).not.toContainText('$20')
  })

  test('Token Inspector keeps sat amounts as whole numbers', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    const amount = page.locator('.token-result-cell', { hasText: 'Amount' })
    await expect(amount).toContainText('29')
    await expect(amount).not.toContainText('$')
    await expect(amount).not.toContainText('0.29')
  })

  test('Verify with mint reports an unreachable mint distinctly from an invalid token', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    // The verify button is opt-in: nothing runs until it is clicked.
    await expect(page.locator('.token-verify-result')).toHaveCount(0)

    await page.getByRole('button', { name: /Verify with mint/ }).click()

    // /v1/keysets and /v1/keys are not mocked, so loadMint() fails — that is a transport
    // failure and must NOT be reported as a bad signature.
    const result = page.locator('.token-verify-result')
    await expect(result).toBeVisible({ timeout: 15_000 })
    await expect(result).toContainText(/Could not reach mint/)
    await expect(result).not.toContainText(/Invalid signature/)
    await expect(result).toHaveClass(/tv-unknown/)
  })

  test('Token Inspector action buttons keep their full label text on mobile (no clipping)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    // A clipped label has scrollWidth > clientWidth (overflow hidden behind the button's
    // own edge) — that was the bug: flex:1 + min-width:0 let these shrink past their text.
    const overflowing = await page.locator('.token-action-btn').evaluateAll(
      els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)
    )
    expect(overflowing).toEqual([])
  })

  test('Token Inspector shows an error for an invalid token (no crash)', async ({ page }) => {
    await page.locator('.token-input').fill('this-is-not-a-cashu-token')
    await page.getByRole('button', { name: 'Inspect Token' }).click()

    await expect(page.locator('.token-error')).toBeVisible()
    await expect(page.locator('.token-error')).toContainText(/Not a Cashu token/)
    // No result grid is rendered for an invalid token.
    await expect(page.locator('.token-result-grid')).toHaveCount(0)
  })

  test('Best Mint Wizard walks through its questions and recommends mints', async ({ page }) => {
    // Step 1 — currency, then how much to store (the latter auto-advances to step 2).
    await expect(page.locator('.wizard-unit-select')).toBeVisible()
    await page.locator('.wizard-unit-select').selectOption('sat')
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    // Step 2 — what matters most (auto-advances to step 3).
    await page.locator('.wizard-opt', { hasText: 'Speed' }).click()
    // Step 3 — backup/restore preference (does not auto-advance).
    await page.locator('.wizard-opt', { hasText: 'Not sure' }).click()

    await page.getByRole('button', { name: /Find my mints/ }).click()

    // Recommendations are computed from the mocked known mints.
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).not.toHaveCount(0)

    // Per-unit NUT-04/05 limits come from the selected unit's method entries.
    await expect(page.locator('.wizard-rec-limits').first()).toContainText('1–1,000,000 sat')
    await expect(page.locator('.wizard-rec-limits').first()).toContainText('1–500,000 sat')
    // ...and the whole-mint caveat is spelled out next to them.
    await expect(page.locator('.wizard-rec-note')).toContainText('reflects the whole mint')
  })

  test('Best Mint Wizard offers only the units online mints actually advertise', async ({ page }) => {
    // Alpha/Bravo/Delta are online and advertise sat + usd; offline Charlie has none.
    const options = page.locator('.wizard-unit-select option')
    await expect(options).toHaveText(['SAT', 'USD'])
  })

  test('Best Mint Wizard excludes mints that do not issue the chosen unit', async ({ page }) => {
    // Only Bravo advertises usd, so it must be the sole recommendation.
    await page.locator('.wizard-unit-select').selectOption('usd')
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Speed' }).click()
    await page.locator('.wizard-opt', { hasText: 'Not sure' }).click()
    await page.getByRole('button', { name: /Find my mints/ }).click()

    await expect(page.locator('.wizard-rec-row')).toHaveCount(1)
    await expect(page.locator('.wizard-rec-row')).toContainText('Bravo Mint')
  })
})
