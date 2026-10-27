import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, makeDleqMint, serveMintInPage, MOCK_MINTS } from './fixtures/mocks'
import { resize } from './fixtures/settle'

// Token Inspector, Verify part, "Mint fee": the exact NUT-02 claim fee from the keysets the mint listed, and the
// status of each keyset the token's coins come from. Fixture mint in the page, constructed tokens (no real funds).

const MINT = MOCK_MINTS[0]!.url
const fee = (page: Page) => page.getByTestId('token-claim-fee')

async function inspect(page: Page, token: string) {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, 1280, 900)
  await page.goto('/tools')
  await page.locator('.token-input').fill(token)
  await page.getByRole('button', { name: /Inspect & Verify Token/ }).click()
  await expect(page.getByTestId('token-verify-part').locator('.token-verify-result').first()).not.toContainText('Verifying', { timeout: 15_000 })
}

test('a fee-charging active keyset: exact fee in sat, keyset active', async ({ page }) => {
  // 3 coins x 400 ppk = 1200 ppk -> ceil(1.2) = 2 sat.
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'valid' }, { amount: 4, dleq: 'valid' }], { inputFeePpk: 400 })
  await serveMintInPage(page, fx)
  await inspect(page, fx.token)
  await expect(fee(page)).toContainText('Claiming this token costs 2 sat in mint fees.')
  await expect(page.getByTestId('token-keyset-status')).toContainText('3 coins · 0.4 sat per coin')
  await expect(page.getByTestId('token-keyset-status')).toContainText('Active')
})

test('no input fee: says so; an inactive keyset suggests swapping soon', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 2, dleq: 'valid' }], { active: false })
  await serveMintInPage(page, fx)
  await inspect(page, fx.token)
  await expect(fee(page)).toContainText('No mint fee to claim this token.')
  await expect(page.getByTestId('token-keyset-status')).toContainText('Swap these coins to an active keyset soon.')
})

test('a keyset the mint does not list: fee unknown, keyset unknown', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 2, dleq: 'valid' }])
  await serveMintInPage(page, { ...fx, routes: { ...fx.routes, keysets: { keysets: [] }, keys: { keysets: [] } } })
  await inspect(page, fx.token)
  await expect(fee(page)).toContainText('Mint fee unknown')
})

test('mint unreachable and no stored keysets: fee unknown, nothing guessed', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 2, dleq: 'valid' }])
  await page.addInitScript(mint => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      return url.startsWith(mint + '/v1/') ? Promise.reject(new TypeError('mint down')) : realFetch(input, init)
    }
  }, fx.mint)
  await inspect(page, fx.token)
  await expect(fee(page)).toContainText('Mint fee unknown: the mint could not be reached.')
  await expect(page.getByTestId('token-keyset-status')).toHaveCount(0)
})
