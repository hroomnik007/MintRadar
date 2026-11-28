import { test, expect, type Page } from '@playwright/test'
import { PaymentRequest } from '@cashu/cashu-ts'
import { installApiMocks, mockRelays, makeCashuToken, MOCK_MINTS } from './fixtures/mocks'
import { resize } from './fixtures/settle'

// Tools (owner, 2026-11-28): after "Inspect token", and after a payment request is pasted, the page moves to the result
// (on a phone it starts below the fold). Typing a request does not move the page.

async function open(page: Page, w: number, h: number) {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, w, h)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tools')
  await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
}
const topOf = (page: Page, sel: string) => page.locator(sel).evaluate(el => el.getBoundingClientRect().top)
const navH = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 50)

test('390px: Inspect token brings the result card to the top of the screen', async ({ page }) => {
  await open(page, 390, 700)
  await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21]))
  await page.getByRole('button', { name: 'Inspect token' }).click()
  await expect(page.getByTestId('token-verdict')).toBeVisible()
  await expect.poll(async () => topOf(page, '[data-testid="token-verdict"]')).toBeLessThan(700 * 0.55)
  expect(await topOf(page, '[data-testid="token-verdict"]')).toBeGreaterThanOrEqual(await navH(page))
})

test('390px: pasting a payment request brings its summary to the top; typing does not move the page', async ({ page }) => {
  await open(page, 390, 700)
  const box = page.getByRole('textbox', { name: 'Payment request' })
  const request = new PaymentRequest([], 'r1', 21, 'sat', [MOCK_MINTS[0]!.url], 'Coffee', true).toEncodedCreqA()
  // typed: no move
  await box.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => scrollY)
  await box.fill(request)
  await expect(page.getByTestId('pr-summary')).toBeAttached()
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => scrollY)).toBe(before)
  // pasted: moves to the summary
  await box.fill('')
  await box.dispatchEvent('paste')
  await box.fill(request)
  await expect.poll(async () => topOf(page, '[data-testid="pr-summary"]')).toBeLessThan(700 * 0.55)
  expect(await topOf(page, '[data-testid="pr-summary"]')).toBeGreaterThanOrEqual(await navH(page))
})
