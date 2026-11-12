import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// CONTRACT: wallet integrations rely on this; do not break.
// Wallets link to https://mintradar.org/mint/{encodeURIComponent(mint.url)}, with mint.url taken from
// GET /api/v1/wallets/mints/{url}. The API side of the contract is
// backend/src/__tests__/integration/wallet-api-mint-detail-contract.test.ts; this pins that the link opens the mint's
// detail page, for a mint URL with a path (https://host/Bitcoin), the harder case for the encoded route.

const MINT = 'https://mint.example.com/Bitcoin'
const link = `/mint/${encodeURIComponent(MINT)}`

test('a wallet link /mint/{encodeURIComponent(url)} opens that mint\'s detail page', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: MINT, name: 'Example mint' } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))

  expect(link).toBe('/mint/https%3A%2F%2Fmint.example.com%2FBitcoin')
  await page.goto(link)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await expect(page.getByText('Example mint').first()).toBeVisible()
  // The page knows it is this mint's page (and not the not-found fallback).
  await expect.poll(() => page.locator('link[rel="canonical"]').getAttribute('href')).toBe(`https://mintradar.org${link}`)
})
